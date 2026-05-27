import tweetRun from "../../../docs/test-run-tweets.json";

const replyUsers = [
  {
    name: "maya",
    handle: "@maya_trades",
    avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=maya-trades",
  },
  {
    name: "noah",
    handle: "@noah_eth",
    avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=noah-eth",
  },
  {
    name: "ira",
    handle: "@ira_markets",
    avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=ira-markets",
  },
  {
    name: "leo",
    handle: "@leo_perps",
    avatarUrl: "https://api.dicebear.com/9.x/notionists/svg?seed=leo-perps",
  },
];

const streamTweets = tweetRun.tweets.map((tweet) => ({
  ...tweet,
  preview: shortenTweet(tweet.text, tweet.mediaUrls.length > 0),
}));

const midpoint = Math.ceil(streamTweets.length / 2);
const tweetsLeft = streamTweets.slice(0, midpoint);
const tweetsRight = streamTweets.slice(midpoint);

export default function Home() {
  return (
    <main className="page">
      <SiteNav />

      <section className="hero-chapter" aria-label="hero">
        <Painting />

        <div className="hero-grid">
          <Stream side="left" tweets={tweetsLeft} />

          <div className="hero-content">
            <HeroBrand />
            <h1 className="display display-1">
              Turn a <em>tweet</em>
              <br />
              into a <em>trade</em>.
            </h1>
            <p className="lede">
              Cassie turns tweets into executable trade ideas. Mention
              her under any post - she makes a trade for you.
            </p>
            <div className="cta-row">
              <a className="btn btn-x" href="/onboarding">
                <span>Continue with</span>
                <svg className="x-logo" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span className="arrow" aria-hidden="true">→</span>
              </a>
            </div>
          </div>

          <Stream side="right" tweets={tweetsRight} />
        </div>
      </section>
    </main>
  );
}

function SiteNav() {
  return (
    <header className="nav" aria-label="Primary">
      <div className="right">
        <a className="nav-action" href="/dashboard">Dashboard</a>
      </div>
    </header>
  );
}

function HeroBrand() {
  return (
    <a className="hero-brand" href="/" aria-label="Cassie home">
      <img src="/cassie-logo-transparent.png" alt="" aria-hidden />
    </a>
  );
}

function Painting() {
  return (
    <div className="chapter-canvas" aria-hidden>
      <video
        className="chapter-video"
        src="/cassie-hero-loop.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className="chapter-vignette" />
      <div className="chapter-grain" />
    </div>
  );
}

type TweetData = {
  authorName: string;
  handle: string;
  avatarUrl: string;
  date: string;
  preview: string;
  url: string;
  current: boolean;
  cassiePrompt: string;
  mediaUrls: string[];
};

function Stream({ side, tweets }: { side: "left" | "right"; tweets: TweetData[] }) {
  const loop = [...tweets, ...tweets];
  return (
    <div className={`stream stream-${side}`} aria-hidden>
      <div className="stream-track">
        {loop.map((t, i) => {
          const replyUser = replyUsers[i % replyUsers.length];
          return <TweetCard key={`${side}-${i}`} {...t} replyUser={replyUser} />;
        })}
      </div>
    </div>
  );
}

type ReplyUser = (typeof replyUsers)[number];

function TweetCard({
  authorName,
  handle,
  avatarUrl,
  date,
  preview,
  url,
  current,
  cassiePrompt,
  mediaUrls,
  replyUser,
}: TweetData & { replyUser: ReplyUser }) {
  const [mediaUrl] = mediaUrls;

  return (
    <article className={`tweet${current ? " tweet-current" : ""}`}>
      <header className="tweet-head">
        <img className="tweet-avatar" src={avatarUrl} alt="" aria-hidden />
        <div className="tweet-id">
          <span className="tweet-name">{authorName}</span>
          <span className="tweet-meta">
            {handle} · {date}
          </span>
        </div>
      </header>
      <p className="tweet-body">{preview}</p>
      {mediaUrl && (
        <img
          className="tweet-media"
          src={mediaUrl}
          alt=""
          aria-hidden
          loading="lazy"
        />
      )}
      <div className="tweet-reply">
        <img
          className="reply-avatar"
          src={replyUser.avatarUrl}
          alt=""
          aria-hidden
        />
        <div className="reply-id">
          <span className="reply-name">
            {replyUser.name} <span className="reply-handle">{replyUser.handle}</span>
          </span>
          <p className="reply-body">
            <span className="reply-mention">@cassie</span> {cassiePrompt}
          </p>
        </div>
      </div>
      <a className="tweet-link" href={url} aria-label={`Open tweet by ${authorName}`} />
    </article>
  );
}

function shortenTweet(text: string, hasMedia: boolean) {
  const clean = text
    .replace(/https:\/\/t\.co\/\S+/g, "")
    .replace(/pic\.twitter\.com\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const maxLength = hasMedia ? 118 : 170;

  return clean.length > maxLength
    ? `${clean.slice(0, maxLength - 3).trim()}...`
    : clean;
}
