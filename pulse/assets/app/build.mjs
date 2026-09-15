import {build} from 'esbuild';
await build({entryPoints:['src/main.js'],bundle:true,minify:true,outfile:'app.bundle.js',format:'iife'});
await build({entryPoints:['src/theme-entry.js'],bundle:true,minify:true,outfile:'theme.bundle.js',format:'iife'});
