import fs from "fs";

type Contents = {
  query: {
    pages: {
      [id: number]: {
        revisions: {
          slots: {
            main: {
              "*": string;
            };
          };
        }[];
      };
    };
  };
};

const waTemplateNames = [
  "{{World Athletics",
  "{{Iaaf name",
  "{{IAAF profile",
  "{{Iaaf profile",
  "{{IAAF simple",
  "{{Iaaf simple",
  "{{Iaafname",
  "{{IAAF",
  "{{Iaaf",
  "{{IAAF name",
  "{{World Athletics profile",
]; // https://en.wikipedia.org/wiki/Special:WhatLinksHere?target=Template%3AWorld+Athletics&namespace=&hidetrans=1&hidelinks=1

const members: { pageid: number; ns: number; title: string }[] = fs.existsSync(
  "./data/members.json"
)
  ? JSON.parse(fs.readFileSync("./data/members.json", "utf-8"))
  : (async () => {
      let cont = "";
      const members: any[] = [];
      do {
        const { query, ...rest } = await (
          await fetch(
            "https://en.wikipedia.org/w/api.php?" +
              new URLSearchParams({
                action: "query",
                list: "categorymembers",
                cmtitle:
                  "Category:World Athletics template with ID different from Wikidata",
                cmlimit: "500",
                format: "json",
                ...(cont ? { cmcontinue: cont } : {}),
              })
          )
        ).json();
        console.log(query, rest);
        cont = rest.continue?.cmcontinue;
        members.push(...query.categorymembers);
      } while (cont);
      fs.writeFileSync("./data/members.json", JSON.stringify(members));
      return members;
    })();

const BATCH_SZ = 10;
for (let i = 0; i < members.length; i += BATCH_SZ) {
  const membersSlice = members.slice(i, i + BATCH_SZ);
  const contents: Contents = await (
    await fetch(
      "https://en.wikipedia.org/w/api.php?" +
        new URLSearchParams({
          action: "query",
          prop: "revisions",
          rvprop: "content",
          format: "json",
          titles: membersSlice.map((mem) => mem.title).join("|"),
          rvslots: "main",
        })
    )
  ).json();
  for (const pageid in contents.query.pages) {
    const title = membersSlice.find((mem) => mem.pageid === +pageid)?.title;
    let wikitext = contents.query.pages[pageid].revisions[0].slots.main["*"];
    const waTemplates = waTemplateNames.flatMap(
      (waTemplate) => wikitext.match(new RegExp(waTemplate, "g")) ?? []
    );
    for (const templateName of waTemplates) {
      wikitext.split(templateName)[1]
    }
  }
  for (const { pageid, ns, title } of membersSlice) {
    const text = await (
      await fetch(
        "https://en.wikipedia.org/w/api.php?" +
          new URLSearchParams({
            action: "query",
            prop: "revisions",
            rvprop: "content",
            format: "json",
            titles: "Anarchism",
            rvslots: "main",
          })
      )
    ).json();
  }
}
