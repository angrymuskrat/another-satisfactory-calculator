# Inline comments

Follow this only when the user has asked you to post. One run makes **one** GitHub review: a summary body plus one inline comment for each place a Negative applies. Only Negatives get posted; Neutral and Positive verdicts stay in chat.

## 1. Before writing

- **Re-fetch the head SHA.** If it moved since the review, re-verify every Negative at the new head.
- **Re-read the existing threads, review bodies and conversation.** Don't duplicate a thread that already covers a Negative. If a reply claims "fixed", check the code. If it really is fixed, drop your item. If it isn't, say so in your comment and cite the line.
- **Check the posting account** (`gh api user --jq .login`). If it's the PR's author, GitHub accepts only `event: COMMENT`. For any other account, default to `COMMENT`, and use `REQUEST_CHANGES` only if the user asks for it.

## 2. Write the comments

- **One comment per location.** A Negative may span several places: the function, its tests, a doc paragraph, a config key. Give the full reasoning at the main location. At each other location, write one line, "Remove with …", pointing back to it.
- **The first line is the action:** "Remove this …", "Revert this file to `BASE`.", "Move … to …", "Fix: …", or "Minor: …".
- **The body is the evidence:** file:line, log or DB counts, the zero-match greps (naming the repos), the sibling left untouched. End with what to keep, so nobody deletes the needed half along with the rest.
- **Shared modules:** if the change is in a module that consumers pin, say it needs a new release or snapshot and a re-pin.
- **Restores:** before telling them to restore something from an earlier branch or commit, check that it still applies to the current base. If it doesn't, say it must be applied by hand, and where.
- **Summary body:** the outline (**Remove**, **Fix**, **Minor**, numbered), plus one line on what wasn't reviewed.
- **Leave out:** `@name` tokens (they notify people and trigger bots), AI-attribution lines, and offers.

Put everything in a scratchpad directory:
- one body file per comment (`c01.md`, `c02.md`, …);
- `summary.md` for the review body;
- `manifest.tsv`, with one tab-separated line per comment: `id`, `file`, `start_line`, `end_line`. `start_line` equals `end_line` for a one-line comment. The numbers are head-side (RIGHT) line numbers.

## 3. Validate the anchors (mandatory)

GitHub rejects a comment whose lines aren't inside a diff hunk, and a multi-line range must fit inside one hunk. Run this from the repo root, with the base set to the merge base from Step 1 of the skill. It runs under bash because zsh treats `path` as `PATH` and `$VAR:x` as a modifier.

```bash
bash -s -- BASE_SHA HEAD_SHA SCRATCH_DIR/manifest.tsv <<'EOF'
B=$1; H=$2
while IFS=$'\t' read -r id file s e; do
  git diff -U3 "$B" "$H" -- "$file" | awk -v id="$id" -v f="$file" -v s="$s" -v e="$e" '
    /^@@/ { split($3, a, ","); st = substr(a[1], 2) + 0; n = (a[2] == "" ? 1 : a[2] + 0)
            if (s >= st && e <= st + n - 1) ok = 1 }
    END   { print id, f ":" s "-" e, (ok ? "OK" : "BAD: not inside one hunk") }'
done < "$3"
EOF
```

Every line must print `OK`. Move any `BAD` anchor to a changed line nearby, or into the hunk that holds the code.

## 4. Build and post

Run this from the scratchpad directory:

```bash
bash -s -- HEAD_SHA COMMENT <<'EOF'
jq -n --arg c "$1" --arg ev "$2" --rawfile b summary.md \
  '{commit_id: $c, event: $ev, body: $b, comments: []}' > review.json
while IFS=$'\t' read -r id file s e; do
  if [ "$s" = "$e" ]; then
    jq --arg p "$file" --argjson l "$e" --rawfile b "$id.md" \
      '.comments += [{path: $p, line: $l, side: "RIGHT", body: $b}]' review.json > t.json
  else
    jq --arg p "$file" --argjson s "$s" --argjson l "$e" --rawfile b "$id.md" \
      '.comments += [{path: $p, start_line: $s, start_side: "RIGHT", line: $l, side: "RIGHT", body: $b}]' review.json > t.json
  fi
  mv t.json review.json
done < manifest.tsv
jq '{commit_id, event, comments: (.comments | length), summary_chars: (.body | length)}' review.json
EOF
```

Before posting, check two things:
- the comment count equals the number of lines in the manifest;
- the head hasn't moved (`gh pr view N --repo OWNER/REPO --json headRefOid --jq .headRefOid`).

Then post:

```bash
gh api -X POST repos/OWNER/REPO/pulls/N/reviews --input review.json --jq '"\(.id) \(.state) \(.html_url)"'
```

If you get a 422, list the PR's reviews to confirm nothing was posted, fix the anchor it names, and resend.

## 5. Verify where it landed

The per-review comments endpoint returns `line: null`. Use the PR's comment list filtered by review id instead:

```bash
gh api repos/OWNER/REPO/pulls/N/comments --paginate --jq '.[] | select(.pull_request_review_id == REVIEW_ID)
  | "\(.path):\(if .start_line then "\(.start_line)-" else "" end)\(.line) \(.commit_id[0:8])"'
```

Every manifest line must appear with the same file, the same lines and the pinned commit.

Report three things: the review URL, the number of comments, and the account that posted them. If an automated fix loop or another agent is working on the PR, say that it will pick up these threads.
