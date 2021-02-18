import test from "ava";
import execa from "execa";

test("outputs help", async (t) => {
  const { stdout } = await execa("./cli.js", ["--help"]);

  t.is(stdout, `
  Tool to sync xtream codes content to a magoware instance

  This module will connect to an xtream codes instance and create a local copy of it's content.
  This local copy will be processed to import each Movie and TV Episode into magoware, setting up categories as needed.

  This only uses public api's for Xtream and Magoware.

  Usage
    $ xtream-to-magoware
    $ node cli.js

  Options
    --cachebust    Empty redis cache
    --unattended   Assume yes for all questions
    --sync-only    Skip import step
    --import-only  Skip sync step

  Examples
    $ xtream-to-magoware --cachebust
    This will clear the redis cache of all local data

    $ xtream-to-magoware --unattended
    This is remove the user prompts, perform a full sync with Xtream Codes
    and import the VODs to Magoware

    $ xtream-to-magoware --unattended --sync-only
    This will only sync the redis cache with Xtream Codes

    $ xtream-to-magoware --unattended --import-only
    This will only sync the redis cache with Xtream Codes
`
  );
});
