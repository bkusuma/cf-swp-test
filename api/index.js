import serverlesswp from 'serverlesswp';
import { validate } from '../util/install.js';
import { setup } from '../util/directory.js';
import sqliteS3 from '../util/sqliteS3.js';
import { register } from '../util/goldilock.js';

const pathToWP = '/tmp/wp';
let initSqliteS3 = false;

// Move the /wp directory to /tmp/wp so that it is writeable.
setup();

// Register the sqlite serverlesswp plugin if using SQLite + S3/R2
if (process.env['SQLITE_S3_BUCKET'] || process.env['SERVERLESSWP_DATA_SECRET']) {
    serverlesswp.registerPlugin(sqliteS3);
}

// ES Module format export for Cloudflare Workers
export default {
    async fetch(request, env, ctx) {
        // Convert Cloudflare Request to Lambda-style event object
        const url = new URL(request.url);
        const event = {
            path: url.pathname,
            httpMethod: request.method,
            headers: Object.fromEntries(request.headers),
            queryStringParameters: Object.fromEntries(url.searchParams),
            body: request.method !== 'GET' && request.method !== 'HEAD' 
                ? await request.text() 
                : null,
            isBase64Encoded: false,
            rawUrl: request.url,
            // Add Cloudflare-specific properties
            cf: request.cf,
        };

        // Initialize SQLite + S3/R2 if needed
        if ((env.SQLITE_S3_BUCKET || env.SERVERLESSWP_DATA_SECRET) && !initSqliteS3) {
            let wpContentPath = pathToWP + '/wp-content';
            let sqlitePluginPath = wpContentPath + '/plugins/sqlite-database-integration';
            await sqliteS3.prepPlugin(wpContentPath, sqlitePluginPath);

            let branchSlug = '';
            let bucketFallback = '';
            
            // Cloudflare-specific branch detection (if using Pages)
            if (env.CF_PAGES) {
                const branch = env.CF_PAGES_BRANCH 
                    ? sqliteS3.branchNameToS3file(env.CF_PAGES_BRANCH)
                    : '';
                branchSlug = branch ? '-' + branch : '';
                bucketFallback = env.CF_PAGES_PROJECT_NAME;
            }

            // Configure the sqliteS3 plugin
            let sqliteS3Config = {
                bucket: env.SQLITE_S3_BUCKET || bucketFallback,
                file: `wp-sqlite-s3${branchSlug}.sqlite`,
                S3Client: {
                    credentials: {
                        "accessKeyId": env.SQLITE_S3_API_KEY || env.CF_PAGES_PROJECT_NAME,
                        "secretAccessKey": env.SQLITE_S3_API_SECRET || env.SERVERLESSWP_DATA_SECRET
                    },
                    region: env.SQLITE_S3_REGION || 'auto',
                }
            };

            if (env.SQLITE_S3_ENDPOINT) {
                sqliteS3Config.S3Client.endpoint = env.SQLITE_S3_ENDPOINT;
            }

            if (env.SQLITE_S3_FORCE_PATH_STYLE || env.SERVERLESSWP_DATA_SECRET) {
                sqliteS3Config.S3Client.forcePathStyle = true;
            }

            if (env.SERVERLESSWP_DATA_SECRET) {
                sqliteS3Config.S3Client.endpoint = 'https://data.serverlesswp.com';
                sqliteS3Config.onAuthError = () => register(
                    sqliteS3Config.bucket,
                    env.SERVERLESSWP_DATA_SECRET
                );
            }

            sqliteS3.config(sqliteS3Config);
            initSqliteS3 = true;
        }

        // Make environment variables available to process.env for compatibility
        // This allows the existing code to work without major changes
        Object.assign(process.env, env);

        // Send the request to the serverlesswp library
        let response = await serverlesswp({ docRoot: pathToWP, event: event });
        
        // Check to see if the database environment variables are in place
        let checkInstall = validate(response);
        
        if (checkInstall) {
            response = checkInstall;
        }

        // Convert Lambda-style response to Cloudflare Response
        return new Response(response.body, {
            status: response.statusCode || 200,
            headers: response.headers || {}
        });
    }
};
