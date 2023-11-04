import fs from "fs";
import wikibaseEdit from "wikibase-edit";
import dotenv from "dotenv";
import { JSDOM } from "jsdom";
import { WBK } from "wikibase-sdk";
const wbk = WBK({
  instance: "https://www.wikidata.org",
  sparqlEndpoint: "https://query.wikidata.org/sparql",
});
dotenv.config();

const P_WAID = "P1146";
const P_REASON = "P2241";
const Q_REDIRECT = "Q45403344";
const P_NAMEDAS = "P1810";
const P_DETMETHOD = "P459";
const Q_HTTPREDIRECT = "Q110227941";
const Q_LINKROT = "Q1193907";
const Q_WITHDRAWN = "Q21441764";

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

fs.unlinkSync("./data/shortWaIds.json");

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
  const idx = items.indexOf(item);
  console.log(idx, "/", items.length);
  if (item.done) continue;
  const qid = item.item.value.split("/").at(-1) as `Q${number}`;
  const name = item.itemLabel.value;
  const oldId = item.id.value;
  const waUrl = `https://worldathletics.org/athletes/_/${oldId}`;
  let attempts = 0;
  let response: Response | null = null;
  try {
    response = await fetch(waUrl);
  } catch (e) {
    response = new Response(null, { status: 502 });
  }
  while (![200, 404, 500].includes(response.status)) {
    console.log(await response.text());
    if (attempts++ > 5) break;
    await new Promise((res) => setTimeout(res, 10000));
    try {
      response = await fetch(waUrl);
    } catch (e) {
      response = new Response(null, { status: 502 });
    }
  }
  const { window } = new JSDOM(await response?.text());
  const newId = response?.url.split("/").at(-1);
  const statedAs = window.document
    .querySelector("meta[name=title]")
    ?.getAttribute("content")
    ?.split(" | ")?.[0];
  console.log(oldId, name, newId, statedAs, response?.status, item.item.value);
  if (statedAs === "Error 404" || statedAs === "Error 500") {
    const editResult = await wbEdit.entity.edit({
      type: "item",
      id: qid,
      claims: {
        [P_WAID]: [
          {
            rank: "deprecated",
            value: oldId,
            qualifiers: {
              [P_REASON]: newId === oldId ? Q_WITHDRAWN : Q_REDIRECT,
            },
          },
          ...(newId !== oldId
            ? [
                {
                  rank: "deprecated",
                  value: newId,
                  qualifiers: {
                    [P_REASON]: Q_LINKROT,
                  },
                },
              ]
            : []),
        ],
      },
      reconciliation: { mode: "merge" },
      summary: `Deprecating World Athletics athlete ID ${oldId}`,
    });
    const depClaimIds = editResult.entity.claims[P_WAID].filter(
      (claim: { qualifiers: { [k: string]: any } }) =>
        P_REASON in claim.qualifiers
    ).map((c: { id: string }) => c.id);
    for (const depClaimId of depClaimIds) {
      await wbEdit.claim.update({
        guid: depClaimId,
        rank: "deprecated",
        summary: `Deprecating World Athletics athlete ID ${oldId}`,
      });
    }
    item.done = true;
    continue;
  }
  const editResult = await wbEdit.entity.edit({
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
  const depClaim = editResult.entity.claims[P_WAID].find(
    (claim: { qualifiers: { [k: string]: any } }) =>
      P_REASON in claim.qualifiers
  );
  await wbEdit.claim.update({
    guid: depClaim?.id,
    rank: "deprecated",
    summary: `Deprecating redirected World Athletics athlete ID ${oldId}`,
    qualifiers: depClaim?.qualifiers,
  });
  item.done = true;
  // fs.writeFileSync("./data/shortWaIds.json", JSON.stringify(items));
}
