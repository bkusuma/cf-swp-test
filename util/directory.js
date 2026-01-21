import fs from 'node:fs';
import { execSync } from 'node:child_process';

export function setup() {
    if (!fs.existsSync('/tmp/wp')) {
        fs.mkdirSync('/tmp/wp');
        try {
            execSync('cp -R /var/task/wp/* /tmp/wp/');
        }
        catch (err) {
            console.log(err);
        }
    }
}
