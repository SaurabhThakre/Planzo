type PageImage = { pageimage?: string };
type ImageInfo = {
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
};

export type DestinationPhoto = {
    imageUrl: string;
    sourceUrl: string;
    credit: string;
    licenseUrl: string;
};

function wikiUrl(host: string, parameters: Record<string, string>) {
    return `https://${host}/w/api.php?` + new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        origin: "*",
        ...parameters,
    });
}

async function wikiQuery<T>(url: string, signal: AbortSignal): Promise<T[]> {
    const response = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.query?.pages) ? data.query.pages : [];
}

function trustedWikiUrl(value: string | undefined, ...hostnames: string[]) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && hostnames.includes(url.hostname) && !url.port && !url.username && !url.password
            ? url.href : null;
    } catch {
        return null;
    }
}

function plainCredit(value: unknown) {
    if (typeof value !== "string") return "";
    return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export async function loadDestinationPhoto(destination: string, signal: AbortSignal): Promise<DestinationPhoto | null> {
    const name = destination.trim();
    const curated = curatedPhotos.get(name.toLowerCase());
    if (curated) return curated;
    if (!name || name.length > 150 || name.includes("|")) return null;
    const [article] = await wikiQuery<PageImage>(wikiUrl("en.wikipedia.org", {
        titles: name,
        redirects: "1",
        prop: "pageimages",
        piprop: "name",
        pilicense: "free",
    }), signal);
    if (typeof article?.pageimage !== "string" || !/\.(?:jpe?g|png|webp)$/i.test(article.pageimage) || article.pageimage.includes("|")) return null;

    const [file] = await wikiQuery<{ imageinfo?: ImageInfo[] }>(wikiUrl("commons.wikimedia.org", {
        titles: "File:" + article.pageimage,
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "800",
        iiextmetadatafilter: "Artist|LicenseShortName|UsageTerms",
    }), signal);
    const image = file?.imageinfo?.[0];
    const imageUrl = trustedWikiUrl(image?.thumburl, "upload.wikimedia.org", "thumb.wikimedia.org");
    const sourceUrl = trustedWikiUrl(image?.descriptionurl, "commons.wikimedia.org");
    const license = plainCredit(image?.extmetadata?.LicenseShortName?.value ?? "");
    const author = plainCredit(image?.extmetadata?.Artist?.value ?? "");
    if (!imageUrl || !sourceUrl || !/^(?:CC BY(?:-SA)? [\d.]+|CC0|Public domain)$/i.test(license)) return null;
    if (/^CC BY/i.test(license) && !author) return null;
    const cc = /^CC (BY(?:-SA)?) ([\d.]+)$/i.exec(license);
    const licenseUrl = cc ? `https://creativecommons.org/licenses/${cc[1].toLowerCase()}/${cc[2]}/`
        : /^CC0$/i.test(license) ? "https://creativecommons.org/publicdomain/zero/1.0/"
        : "https://creativecommons.org/publicdomain/mark/1.0/";
    return { imageUrl, sourceUrl, credit: [author, license].filter(Boolean).join(" · "), licenseUrl };
}

const goa: DestinationPhoto = {
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/8/8c/Dona_Paula%2C_Goa.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Dona_Paula,_Goa.jpg",
    credit: "Dona Paula, Goa · Binobose · CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};
const tokyo: DestinationPhoto = {
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/9/98/Tokyo_skyline_seen_from_Tokyo_Skytree.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Tokyo_skyline_seen_from_Tokyo_Skytree.jpg",
    credit: "Tokyo skyline · Ruthsic · CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
};
const curatedPhotos = new Map([["goa", goa], ["goa, india", goa], ["tokyo", tokyo], ["tokyo, japan", tokyo]]);
