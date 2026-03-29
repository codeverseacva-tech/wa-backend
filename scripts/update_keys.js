
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const secret = 'local-dev-secret-key-32-characters-long';

const anonToken = jwt.sign({ role: 'anon', iat: 1514764800, exp: 3933561600 }, secret);
const serviceRoleToken = jwt.sign({ role: 'service_role', iat: 1514764800, exp: 3933561600 }, secret);

const envPath = path.join(process.cwd(), '.env.local');
let envContent = fs.readFileSync(envPath, 'utf8');

envContent = envContent.replace(/SUPABASE_ANON_KEY=.*/, `SUPABASE_ANON_KEY=${anonToken}`);
envContent = envContent.replace(/SUPABASE_SERVICE_ROLE_KEY=.*/, `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleToken}`);

fs.writeFileSync(envPath, envContent);

console.log('Updated .env.local with new Supabase keys.');
