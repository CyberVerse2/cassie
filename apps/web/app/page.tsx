import tweetRun from "../../../docs/test-run-tweets.json";
import { HomeAuthCta } from "./components/home-auth-cta";
import { TweetDeck } from "./components/tweet-deck";
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

const streamTweetPrompts = ["trade this", "trade this", "critic this", "watch this"] as const;

type TestRunTweet = {
  url: string;
  current: boolean;
  authorName?: string;
  handle?: string;
  avatarUrl?: string;
  date?: string;
  text?: string;
  cassiePrompt?: string;
  mediaUrls?: string[];
  unavailable?: boolean;
};

function hasDisplayText(tweet: TestRunTweet): tweet is TestRunTweet & { text: string } {
  return !tweet.unavailable && typeof tweet.text === "string" && tweet.text.trim().length > 0;
}

function summarizeTweetText(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/pic\.twitter\.com\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 132) return cleaned;
  const cutoff = cleaned.lastIndexOf(" ", 132);
  return `${cleaned.slice(0, cutoff > 88 ? cutoff : 132).trim()}...`;
}

const streamTweets = (tweetRun.tweets as TestRunTweet[]).filter(hasDisplayText).map((tweet, index) => {
  const handle = xHandleFromUrl(tweet.url);
  const displayHandle = tweet.handle ?? `@${handle}`;
  return {
    ...tweet,
    authorName: tweet.authorName ?? handle,
    handle: displayHandle,
    avatarUrl: tweet.avatarUrl ?? `https://unavatar.io/x/${displayHandle.replace(/^@/, "")}`,
    date: tweet.date ?? (tweet.current ? "now" : `${index + 1}h`),
    preview: summarizeTweetText(tweet.text),
    cassiePrompt: tweet.cassiePrompt ?? streamTweetPrompts[index % streamTweetPrompts.length],
  };
});

const midpoint = Math.ceil(streamTweets.length / 2);
const tweetsLeft = streamTweets.slice(0, midpoint);
const tweetsRight = streamTweets.slice(midpoint);

const deckCards = streamTweets.map((t, i) => {
  const replyUser = replyUsers[i % replyUsers.length];
  return {
    ...t,
    replyName: replyUser.name,
    replyHandle: replyUser.handle,
    replyAvatarUrl: replyUser.avatarUrl,
  };
});

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
              Trade the
              <br />
              <em>timeline</em>.
            </h1>
            <p className="lede">
              Mention Cassie under a post.
              <br />
              She figures out if there&apos;s an opportunity there and makes a trade for you.
            </p>
            <TweetDeck cards={deckCards} />
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
        <a
          className="nav-action"
          href="https://docs.cassie.trade"
          target="_blank"
          rel="noreferrer"
        >
          Docs
        </a>
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
  mediaUrls?: string[];
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
  const mediaUrl = mediaUrls?.[0];

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
      {mediaUrl ? (
        <img
          className="tweet-media"
          src={mediaUrl}
          alt=""
          aria-hidden
          decoding="async"
        />
      ) : null}
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
            <span className="reply-mention">@cassiedottrade</span> {cassiePrompt}
          </p>
        </div>
      </div>
      <a className="tweet-link" href={url} aria-label={`Open tweet by ${authorName}`} />
    </article>
  );
}
