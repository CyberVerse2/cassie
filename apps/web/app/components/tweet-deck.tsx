"use client";

import { useEffect, useState } from "react";

type DeckCard = {
  authorName: string;
  handle: string;
  avatarUrl: string;
  date: string;
  preview: string;
  url: string;
  current: boolean;
  cassiePrompt: string;
  replyName: string;
  replyHandle: string;
  replyAvatarUrl: string;
};

const VISIBLE = 3;
const INTERVAL = 4200;
const ANGLES = [-3.5, 3, -6];
const OFFSET_X = [0, 14, -12];
const OFFSET_Y = [0, 16, 30];
const SCALES = [1, 0.96, 0.92];

export function TweetDeck({ cards }: { cards: DeckCard[] }) {
  const [index, setIndex] = useState(0);
  const count = cards.length;

  useEffect(() => {
    if (count <= 1) return;
    if (!window.matchMedia("(max-width: 1024px)").matches) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, INTERVAL);
    return () => window.clearInterval(id);
  }, [count]);

  return (
    <div className="tweet-deck" aria-hidden>
      <div className="tweet-deck-stage">
        {cards.map((card, i) => {
          const depth = (i - index + count) % count;
          const visible = depth < VISIBLE;
          const style = {
            zIndex: count - depth,
            opacity: visible ? 1 : 0,
            transform: visible
              ? `translate(${OFFSET_X[depth]}px, ${OFFSET_Y[depth]}px) scale(${SCALES[depth]}) rotate(${ANGLES[depth]}deg)`
              : `translate(${OFFSET_X[VISIBLE - 1]}px, ${OFFSET_Y[VISIBLE - 1]}px) scale(${SCALES[VISIBLE - 1]}) rotate(${ANGLES[VISIBLE - 1]}deg)`,
            pointerEvents: depth === 0 ? ("auto" as const) : ("none" as const),
          };
          return (
            <article
              key={card.url + i}
              className={`tweet${card.current ? " tweet-current" : ""}${depth === 0 ? " tweet-deck-top" : ""}`}
              style={style}
            >
              <header className="tweet-head">
                <img className="tweet-avatar" src={card.avatarUrl} alt="" aria-hidden />
                <div className="tweet-id">
                  <span className="tweet-name">{card.authorName}</span>
                  <span className="tweet-meta">{card.handle} · {card.date}</span>
                </div>
              </header>
              <p className="tweet-body">{card.preview}</p>
              <div className="tweet-reply">
                <img className="reply-avatar" src={card.replyAvatarUrl} alt="" aria-hidden />
                <div className="reply-id">
                  <span className="reply-name">
                    {card.replyName} <span className="reply-handle">{card.replyHandle}</span>
                  </span>
                  <p className="reply-body">
                    <span className="reply-mention">@cassiedottrade</span> {card.cassiePrompt}
                  </p>
                </div>
              </div>
              <a className="tweet-link" href={card.url} aria-label={`Open tweet by ${card.authorName}`} />
            </article>
          );
        })}
      </div>
    </div>
  );
}
