import {readFile} from 'node:fs/promises';
import {installNative,nativePaths} from './lib/native-install.mjs';
import {createNativeDeployment} from './lib/native-deployment.mjs';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const deployment=createNativeDeployment({...nativePaths(config),config});
await deployment.run(process.argv[3],({progress})=>installNative({...config,progress}));
