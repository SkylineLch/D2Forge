'use strict';
// Push local commits to GitHub via the REST "Git Data" API — fallback only.
//
// Prefer plain `git push`. It works once `gh auth setup-git` has installed the
// credential helper, but only while the proxy environment is cleared:
//
//   env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
//     GH_TOKEN=<token> git push origin main
//
// The proxy in this environment 502s on CONNECT to github.com and, worse,
// sometimes answers api.github.com with a certificate for an unrelated host.
// When neither route works, this script still can: the Git Data API exposes
// the same primitives git uses over the wire (blobs -> trees -> commits ->
// ref), and it replays local history commit by commit so the remote ends up
// with the same commits and messages.

const { execFileSync } = require('child_process');
const https = require('https');

const OWNER = 'SkylineLch';
const REPO = 'D2Forge';
const TOKEN = (process.env.GH_TOKEN || '').trim();
if (!TOKEN) {
  console.error('Set GH_TOKEN to a GitHub token with `repo` scope.');
  process.exit(1);
}
const BRANCH = 'main';

function api(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request(
      {
        host: 'api.github.com',
        path: endpoint,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'd2forge-push',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* non-JSON error page */
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
          reject(new Error(`${method} ${endpoint} -> ${res.statusCode}: ${text.slice(0, 400)}`));
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function blobFor(sha) {
  // `git cat-file blob` gives the raw bytes; base64 is what the API wants.
  return execFileSync('git', ['cat-file', 'blob', sha], { maxBuffer: 64 * 1024 * 1024 }).toString('base64');
}

/** Every tracked path in `commit`, as { path, mode, sha }. */
function listTree(commit) {
  const out = git('ls-tree', '-r', '-z', commit);
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const meta = line.slice(0, tab).split(/\s+/);
      return { mode: meta[0], type: meta[1], sha: meta[2], path: line.slice(tab + 1) };
    });
}

async function main() {
  // The blobs/trees API returns 409 on a brand-new, empty repository, so seed
  // it with one file first. That commit becomes the parent of our history.
  let seed = null;
  try {
    const existing = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    seed = existing.object.sha;
    console.log(`branch already exists at ${seed.slice(0, 7)}, appending`);
  } catch {
    const seeded = await api('PUT', `/repos/${OWNER}/${REPO}/contents/.seed`, {
      message: 'chore: initialise repository',
      content: Buffer.from('D2Forge\n').toString('base64'),
    });
    seed = seeded.commit.sha;
    console.log(`seeded empty repo, root commit ${seed.slice(0, 7)}`);
  }

  const all = git('rev-list', '--reverse', BRANCH).split('\n').filter(Boolean);

  // Resume support. Tree SHAs are content hashes, so a local commit's tree is
  // byte-identical to a remote tree built from the same files. Walk from the
  // tip backwards to find the newest commit already present remotely, then only
  // send what comes after it — re-running the script is idempotent.
  let resumeIndex = 0;
  let parent = seed;
  for (let i = all.length - 1; i >= 0; i--) {
    const treeSha = git('rev-parse', `${all[i]}^{tree}`);
    const present = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${treeSha}`).catch(() => null);
    if (present) {
      resumeIndex = i + 1;
      // The remote commit chain has different SHAs, so continue from the
      // remote tip rather than the local commit.
      parent = (await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
      console.log(`resuming after local ${all[i].slice(0, 7)} (remote head ${parent.slice(0, 7)})`);
      break;
    }
  }

  const commits = all.slice(resumeIndex);
  if (commits.length === 0) {
    console.log('nothing to push, remote is already up to date');
    return;
  }
  console.log(`replaying ${commits.length} commit(s) into ${OWNER}/${REPO}`);

  // Reuse identical blobs across commits — most files never change.
  const blobCache = new Map();
  // `parent` was resolved above (seed commit, or the remote tip when resuming).

  for (const sha of commits) {
    const meta = {
      message: git('log', '-1', '--format=%B', sha),
      author: git('log', '-1', '--format=%an <%ae>', sha),
      date: git('log', '-1', '--format=%aI', sha),
    };
    const entries = listTree(sha);

    const treeItems = [];
    for (const e of entries) {
      let blobSha = blobCache.get(e.sha);
      if (!blobSha) {
        const created = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
          content: blobFor(e.sha),
          encoding: 'base64',
        });
        blobSha = created.sha;
        blobCache.set(e.sha, blobSha);
      }
      treeItems.push({
        path: e.path,
        mode: e.mode === '100755' ? '100755' : '100644',
        type: 'blob',
        sha: blobSha,
      });
    }

    const tree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: treeItems });

    const name = meta.author.replace(/ <.*$/, '');
    const email = (meta.author.match(/<(.*)>/) || [])[1];
    const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
      message: meta.message,
      tree: tree.sha,
      parents: parent ? [parent] : [],
      author: { name, email, date: meta.date },
      committer: { name, email, date: meta.date },
    });

    console.log(`  ${sha.slice(0, 7)} -> ${commit.sha.slice(0, 7)}  ${entries.length} files  ${meta.message.split('\n')[0]}`);
    parent = commit.sha;
  }

  // First push creates the ref; later runs fast-forward it.
  let refExists = true;
  try {
    await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  } catch {
    refExists = false;
  }

  if (refExists) {
    await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: parent, force: true });
  } else {
    await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: parent });
  }

  const repo = await api('PATCH', `/repos/${OWNER}/${REPO}`, { default_branch: BRANCH });
  console.log(`\ndone: ${repo.html_url}  default=${repo.default_branch}  head=${parent}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
