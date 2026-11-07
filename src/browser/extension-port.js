export function onPortDisconnect(port,listener,runtime=globalThis.chrome?.runtime){
 port.onDisconnect.addListener(()=>{
  // Chrome exposes disconnect errors (including BFCache closure) only in this callback.
  void runtime?.lastError;
  listener();
 });
}
