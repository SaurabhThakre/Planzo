import {Badge,Button,Icon} from './ui';

export function AppHeader({name,busy=false,onHome,onSignIn,onSignOut}:{
 name?:string;busy?:boolean;onHome:()=>void;onSignIn:()=>void;onSignOut:()=>void;
}){
 const initials=(name||'').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();
 return <header className="topbar live-header"><div className="topbar-inner">
  <button type="button" className="brand" aria-label="Planzo home" onClick={onHome}><Icon brand/><span>Planzo</span></button>
  <Badge tone="positive">Shared trips</Badge>
  <div className="header-actions">
   {name?<><div className="profile-chip" role="group" aria-label={'Signed in as '+name} title={name}><span className="profile-avatar" aria-hidden="true">{initials||'P'}</span><span className="profile-name">{name}</span></div><Button variant="ghost" disabled={busy} onClick={onSignOut}>Sign out</Button></>:<Button variant="secondary" onClick={onSignIn}>Sign in</Button>}
  </div>
 </div></header>;
}
