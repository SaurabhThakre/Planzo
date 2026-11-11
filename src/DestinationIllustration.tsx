import type { CoverScene } from "../supabase/functions/planzo-destination-cover/scene";

const colors = {
    dawn: ["#ffdfbe", "#fd955b", "#7c718c", "#475b69", "#b8dbcb"],
    daylight: ["#bedfe5", "#fff0b5", "#7dabb0", "#355f68", "#c8e2b9"],
    dusk: ["#b4a2c8", "#ffd8a5", "#746f9f", "#424363", "#a6adc3"],
};
const foreground = {
    coast: "M0 131Q90 115 167 143T340 149T520 139V200H0Z",
    mountains: "M0 175L115 114L167 149L287 72L407 149L520 108V200H0Z",
    city: "M0 162H45V124H78V153H115V104H141V138H161V120H201V153H239V88H256V72H260V88H279V148H316V112H350V152H381V104H415V151H449V128H481V158H520V200H0Z",
    desert: "M0 165Q80 113 174 150T332 141T520 132V200H0Z",
    countryside: "M0 154Q110 90 227 144T427 148Q483 116 520 115V200H0Z",
};

export function DestinationIllustration({ scene, destination, compact }: {
    scene: CoverScene; destination: string; compact: boolean;
}) {
    const [sky, sun, distance, land, near] = colors[scene.palette];
    return <figure className={"destination-cover destination-photo" + (compact ? " compact" : "")}>
        <svg className="destination-illustration" role="img" aria-label={`${destination} illustration`}
          viewBox="0 0 520 200" preserveAspectRatio="xMidYMid slice">
            <rect width="520" height="200" fill={sky}/>
            <circle cx="373" cy="72" r="35" fill={sun}/>
            <path d="M0 151Q82 86 164 130T317 134T520 113V200H0Z" fill={distance}/>
            <path d={foreground[scene.landscape]} fill={land}/>
            <path d="M0 186Q100 147 220 180T430 175T520 167V200H0Z" fill={near}/>
        </svg>
        <figcaption>Gemini illustration</figcaption>
    </figure>;
}
