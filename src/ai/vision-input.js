export function configureBrowserVision(processor){
 // The upstream config omits Python defaults; Transformers.js needs normalization explicitly.
 const image=processor.image_processor;
 image.do_normalize=true;
 image.min_pixels=65536;
 image.max_pixels=262144;
}
