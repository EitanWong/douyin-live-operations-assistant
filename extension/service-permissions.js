// Chrome host match patterns cover every port and must omit URL.origin's port.
export function servicePermissionPattern(value){
 const url=new URL(value);
 return `${url.protocol}//${url.hostname}/*`;
}
