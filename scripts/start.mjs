import { cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
import { spawn } from 'node:child_process';
await cp('public','.next/standalone/public',{recursive:true});
await cp('.next/static','.next/standalone/.next/static',{recursive:true});
const child=spawn(process.execPath,['.next/standalone/server.js'],{stdio:'inherit',env:{...process.env,HOSTNAME:process.env.BIND_ADDRESS || '127.0.0.1'}});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??0));
