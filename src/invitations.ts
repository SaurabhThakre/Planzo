// Accept new UUID invitations and existing opaque tokens without invalidating old links.
export function invitationToken(value:string):string{
 const raw=value.trim().toLowerCase();
 const valid=(x:string)=>/^[a-f0-9]{64}$/.test(x)||/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
 if(valid(raw))return raw;
 try{const url=new URL(value.trim());const token=url.hash.match(/^#\/join\/([^/]+)$/)?.[1]?.toLowerCase()||'';return valid(token)?token:''}catch{return ''}
}
