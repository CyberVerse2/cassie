import tweetRun from "../../../docs/test-run-tweets.json";
import { HomeAuthCta } from "./components/home-auth-cta";
import { xHandleFromUrl } from "./lib/x-post";

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

const streamTweetPrompts = ["trade this", "fade this", "critic this", "watch this"] as const;

const streamTweets = tweetRun.tweets.map((tweet, index) => {
  const handle = xHandleFromUrl(tweet.url);
  return {
    ...tweet,
    authorName: handle,
    handle: `@${handle}`,
    avatarUrl: `https://unavatar.io/x/${handle}`,
    date: tweet.current ? "now" : `${index + 1}h`,
    preview: tweet.current ? "Latest tagged tweet ready for Cassie." : "Tagged tweet ready for Cassie.",
    cassiePrompt: streamTweetPrompts[index % streamTweetPrompts.length],
  };
});

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
              <HomeAuthCta />
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
  replyUser,
}: TweetData & { replyUser: ReplyUser }) {
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
