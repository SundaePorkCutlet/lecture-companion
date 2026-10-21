import {createImageProcessor} from './image-processor.mjs';
const processImage=createImageProcessor();
process.on('message',async input=>process.send(await processImage(input)));
