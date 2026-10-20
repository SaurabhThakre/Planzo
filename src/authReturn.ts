export type AuthReturn = { callback:boolean; recovery:boolean; failed:boolean; expired:boolean };

// URL parameters choose a helpful screen, never permission to change a password.
export function readAuthReturn(search:string,hash:string):AuthReturn {
  const query=new URLSearchParams(search);
  const fragment=new URLSearchParams(hash.startsWith('#/')?'':hash.replace(/^#/,''));
  const errorCode=query.get('error_code')||fragment.get('error_code');
  const recovery=query.get('auth')==='recovery'||fragment.get('type')==='recovery';
  const failed=['error','error_code','error_description'].some(key=>query.has(key)||fragment.has(key));
  return {callback:query.has('auth')||query.has('code')||recovery||failed||fragment.has('access_token'),
    recovery,failed,expired:errorCode==='otp_expired'};
}

export function resolveAuthReturn(result:AuthReturn,recoveryVerified:boolean,sessionFailed:boolean){
  if(result.recovery){
    if(recoveryVerified&&!result.failed&&!sessionFailed)return {route:'recovery',reset:true,message:''};
    return {route:'recovery',reset:false,message:result.expired?
      'This recovery link has expired or has already been used. Request a new recovery email and enter its code below.':
      'This recovery link could not be completed in this browser. Enter the code from your newest recovery email, or request a new one below.'};
  }
  if(result.failed||sessionFailed)return {route:'signin',reset:false,message:
    'This email link could not be completed. Sign in again or request a new email. For password recovery, choose Forgot password.'};
  return {route:'',reset:recoveryVerified,message:''};
}
