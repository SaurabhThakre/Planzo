import { cloneElement, isValidElement, useId } from "react";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { assets } from "./assets";
import type { Range, Trip } from "./domain";
import type { PlanningRequest } from './privatePlanning';
const urls: Record<string, string> = {
    clock: assets.overview.imgIconClock,
    star: assets.aiPlans.imgIconStar,
    plane: assets.builder.imgIconPlane1,
    home: assets.setup.imgIconHome,
    map: assets.setup.imgIconMap,
    people: assets.setup.imgIconPeople,
    wallet: assets.setup.imgIconWallet,
    lock: assets.entry.imgIconLock,
    heart: assets.entry.imgIconHeart,
    check: assets.private.imgIconCheck,
    edit: assets.private.imgIconEdit,
    calendar: assets.review.imgIconCalendar,
    bed: assets.review.imgIconBed,
    boat: assets.review.imgIconBoat,
    sun: assets.builder.imgIconSun,
    coffee: assets.builder.imgIconCoffee,
    leaf: assets.parsed.imgIconLeaf,
};
export function Icon({ name = "check", brand = false, }: {
    name?: string;
    brand?: boolean;
}) {
    return (<span className={"icon " + (brand ? "brand-icon" : "")} aria-hidden="true">
      <img src={brand ? assets.entry.imgIconPlane : urls[name] || urls.check} alt=""/>
    </span>);
}
export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost";
    children: ReactNode;
}) {
    return (<button type="button" className={"button " + variant + " " + className} {...props}>
      {children}
    </button>);
}
export function Badge({ children, tone = "neutral", }: {
    children: ReactNode;
    tone?: "neutral" | "positive" | "pending" | "alert";
}) {
    return <span className={"badge " + tone}>{children}</span>;
}
export function ItineraryTypeBadge({kind,label}:{kind:string;label?:string}){
    const type=kind==='travel'?'transport':kind;
    const labels:Record<string,string>={food:'Meal',rest:'Free time',activity:'Activity',stay:'Stay',transport:'Transport'};
    const marks:Record<string,ReactNode>={
        food:<><path d="M4 3v5a2 2 0 0 0 4 0V3M6 3v18M20 3c-3 1-5 4-5 8h5M20 3v18"/></>,
        rest:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></>,
        activity:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
        stay:<><path d="M3 18V6m18 12V9H3m0 6h18M6 9V5h12v4"/></>,
        transport:<><path d="m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2"/></>,
    };
    const known=Object.hasOwn(labels,type);
    return <span className={'badge itinerary-type type-'+(known?type:'item')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{known?marks[type]:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}</svg><span>{label||labels[type]||'Item'}</span></span>;
}
export function Card({ title, sub, children, tone = "", className = "", }: {
    title?: string;
    sub?: ReactNode;
    children?: ReactNode;
    tone?: string;
    className?: string;
}) {
    return (<section className={"card " + tone + " " + className}>
      {title && <h2>{title}</h2>}
      {sub && <p className="small muted">{sub}</p>}
      {children}
    </section>);
}
export function Note({ title, children, tone = "mint", icon = "lock", }: {
    title: string;
    children: ReactNode;
    tone?: string;
    icon?: string;
}) {
    return (<div className={"note " + tone}>
      <Icon name={icon}/>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>);
}
export function Feature({ icon = "check", title, children, }: {
    icon?: string;
    title: string;
    children?: ReactNode;
}) {
    return (<div className="feature">
      <span className="icon-tile">
        <Icon name={icon}/>
      </span>
      <div>
        <strong>{title}</strong>
        {children && <p className="small muted">{children}</p>}
      </div>
    </div>);
}
export function Actions({ children }: {
    children: ReactNode;
}) {
    return <div className="actions">{children}</div>;
}
export function PlanningRequestSummary({requests}:{requests:PlanningRequest[]}){
    if(!requests.length)return <p className="small muted">No planning requests were shared in this earlier summary.</p>;
    const kinds={activity:'Activity or place',food:'Meal requirement',stay:'Stay requirement',rule:'Condition to verify'};
    return <ul className="confirmed-requests" aria-label="Saved shared planning requests">{requests.map((r,i)=><li key={i}><div><strong>{r.title}</strong><p className="caption muted">{kinds[r.kind]}</p></div><Badge tone={r.priority==='hard'?'pending':'neutral'}>{r.priority==='hard'?'Must-have':'Flexible'}</Badge></li>)}</ul>;
}
export function Field({ label, children, hint, }: {
    label: string;
    children: ReactNode;
    hint?: string;
}) {
    const id = useId();
    return (<label className="field" htmlFor={id}>
      <span id={id + "-label"}>{label}</span>
      {isValidElement(children)
            ? cloneElement(children as ReactElement<{
                id?: string;
                "aria-labelledby"?: string;
                "aria-describedby"?: string;
            }>, {
                id,
                "aria-labelledby": id + "-label",
                "aria-describedby": hint ? id + "-hint" : undefined,
            })
            : children}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </label>);
}
export const money = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
export const range = (r: Range) => money(r[0]) +
    "–" +
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(r[1]);
export function Total({ value, complete = true, }: {
    value: Range;
    complete?: boolean;
}) {
    return (<div className="total">
      <span className="eyebrow">YOUR COMPLETE ESTIMATE</span>
      <p className="amount">
        {complete ? range(value) : "Awaiting verified prices"}
      </p>
      <p className="small muted">Per person · includes 10% contingency</p>
    </div>);
}
export function Coast({ variant = "small", }: {
    variant?: "large" | "small" | "hero";
}) {
    const src = variant === "large"
        ? assets.entry.imgEditableIllustrationGoaCoast
        : variant === "hero"
            ? assets.builder.imgEditableIllustrationGoaCoast
            : assets.private.imgEditableIllustrationGoaCoast;
    return (<img className={"coast " + variant} src={src} alt="Illustrated Goa coastline with a palm tree, sailboat and warm sunset"/>);
}
export const dateText = (value: string) => new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
});
export function windowText(trip: Trip, id = trip.windowId) {
    const w = trip.windows.find((w) => w.id === id);
    return w ? dateText(w.start) + " → " + dateText(w.end) : "Choose travel dates";
}
export function Hero({ trip, title, sub, }: {
    trip: Trip;
    title: string;
    sub: string;
}) {
    return (<section className="hero">
      <div>
        <span className="eyebrow">
          {trip.destination.toUpperCase()} · {windowText(trip)}
        </span>
        <h2>{title}</h2>
        <p className="small">{sub}</p>
      </div>
      <Coast variant="hero"/>
    </section>);
}
export function Empty({ title, children, }: {
    title: string;
    children: ReactNode;
}) {
    return (<Card title={title} tone="mint">
      <Coast />
      {children}
    </Card>);
}
