import fs from "fs";
import wikibaseEdit from "wikibase-edit";
import dotenv from "dotenv";
import { JSDOM } from "jsdom";
dotenv.config();

const P_WAID = "P1146";
const P_REASON = "P2241";
const Q_REDIRECT = "Q45403344";
const P_NAMEDAS = "P1810";
const P_DETMETHOD = "P459";
const Q_HTTPREDIRECT = "Q110227941";

type IdItem = {
  item: {
    type: "uri";
    value: string;
  };
  id: {
    type: "literal";
    value: string;
  };
  itemLabel: {
    "xml:lang": "en";
    type: "literal";
    value: string;
  };
  done?: boolean;
};
type CompetitorBasicInfo = {
  resultsByYear: {
    activeYears: string[];
  };
};

let items: IdItem[];
try {
  items = JSON.parse(fs.readFileSync("./data/shortWaIds.json", "utf-8"));
} catch {
  const {
    results: { bindings },
  } = await (
    await fetch(
      `https://query.wikidata.org/sparql?query=` +
        encodeURI(`
SELECT ?item ?itemLabel ?id
WHERE
{
  ?item wdt:P1146 ?id.
  FILTER(STRLEN(?id) <= 6).
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY ASC(xsd:integer(?id))`),
      {
        headers: { Accept: "application/sparql-results+json" },
      }
    )
  ).json();
  fs.writeFileSync("./data/shortWaIds.json", JSON.stringify(bindings));
  items = bindings;
}

const wbEdit = wikibaseEdit({
  instance: "https://www.wikidata.org",
  credentials: {
    oauth: {
      consumer_key: process.env.CONSUMER_TOKEN,
      consumer_secret: process.env.CONSUMER_SECRET,
      token: process.env.ACCESS_TOKEN,
      token_secret: process.env.ACCESS_SECRET,
    },
  },
  userAgent: "wikiTrackBot/v2.0.0-ids (https://github.com/hpr/fixWaIds)",
  bot: true,
  maxlag: 10,
});

for (const item of items) {
  if (item.done) continue;
  const qid = item.item.value.split("/").at(-1);
  const name = item.itemLabel.value;
  const oldId = item.id.value;
  const { window } = new JSDOM(
    await (await fetch(`https://worldathletics.org/athletes/_/${oldId}`)).text()
  );
  const newId = window.document
    .querySelector("meta[name=url]")
    ?.getAttribute("content")
    ?.split("/")
    .at(-1)
    ?.split("-")
    .at(-1);
  const statedAs = window.document
    .querySelector("meta[name=title]")
    ?.getAttribute("content")
    ?.split(" | ")[0];
  console.log(oldId, name, newId, statedAs);
  await wbEdit.entity.edit({
    type: "item",
    id: qid,
    claims: {
      [P_WAID]: [
        {
          value: newId,
          qualifiers: { [P_NAMEDAS]: statedAs },
          references: {
            [P_DETMETHOD]: Q_HTTPREDIRECT,
          },
        },
        {
          rank: "deprecated",
          value: oldId,
          qualifiers: {
            [P_REASON]: Q_REDIRECT,
          },
        },
      ],
    },
    reconciliation: { mode: "merge" },
    summary: `Updating World Athletics athlete ID from deprecated value ${oldId} to new value ${newId}`,
  });
  item.done = true;
  break;
}
