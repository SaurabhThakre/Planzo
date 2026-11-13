import type { ReactNode } from 'react';
import { Badge, Button, Icon } from './ui';
export function ProfileAvatar({ name }: {
    name: string;
}) {
    const initials = name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
    return <span className="profile-avatar" aria-hidden="true">{initials || 'P'}</span>;
}
export function AppHeader({ name, busy = false, onHome, onHelp, onSignIn, onSignOut, onProfile, reminder }: {
    reminder?: ReactNode;
    name?: string;
    busy?: boolean;
    onHome: () => void;
    onHelp: () => void;
    onSignIn: () => void;
    onSignOut: () => void;
    onProfile: () => void;
}) {
    return <header className="topbar live-header"><div className="topbar-inner">
  <button type="button" className="brand" aria-label="Planzo home" onClick={onHome}><Icon brand/><span>Planzo</span></button>
  <Badge tone="positive">Shared trips</Badge>
  <div className="header-actions">
   <Button variant="ghost" className="header-help" onClick={onHelp}><Icon name="help"/>Help</Button>
   {name ? <><button type="button" className="profile-chip" aria-label={'Profile settings for ' + name} title="Profile settings" onClick={onProfile}><ProfileAvatar name={name}/><span className="profile-name">{name}</span></button><Button variant="ghost" disabled={busy} onClick={onSignOut}>Sign out</Button></> : <Button variant="secondary" onClick={onSignIn}>Sign in</Button>}
  </div>
 </div>{reminder}</header>;
}
