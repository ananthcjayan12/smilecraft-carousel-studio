import './build-marketing.mjs';
import {build} from 'esbuild';

// A single module avoids a network waterfall through page imports on slow connections.
await build({
 entryPoints:['web/v4/app.js'],
 outfile:'web/v4/studio.bundle.js',
 bundle:true,
 format:'esm',
 target:['chrome110','safari16.4','firefox115'],
 minify:true,
 sourcemap:false,
 logLevel:'info'
});
