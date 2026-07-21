"use client";

import Link from "next/link";

import { AppNav } from "@/components/features/AppNav";
import {
  DEVELOPER_EMAIL,
  DEVELOPER_NAME,
  DONATE_URL,
  SITE_NAME,
  SITE_NAME_SHORT,
} from "@/lib/site";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-border pt-8">
      <h2 className="font-serif text-xl font-medium text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-secondary">{children}</div>
    </section>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

export function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <AppNav />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">About</p>
        <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {SITE_NAME}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-secondary">
          {SITE_NAME_SHORT} is a fan-built baseball companion: live and historical games,
          Statcast-style spray and trajectory views, and a few nerdier team standings. It is
          not affiliated with Major League Baseball.
        </p>

        <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted" aria-label="On this page">
          <a href="#product" className="hover:text-foreground">
            The product
          </a>
          <a href="#data" className="hover:text-foreground">
            Data &amp; APIs
          </a>
          <a href="#developer" className="hover:text-foreground">
            The developer
          </a>
        </nav>

        <div className="mt-10 space-y-10">
          <Section id="product" title="The product">
            <p>
              Watch today&apos;s slate with live pitch feeds, win-probability context, and
              play-by-play. Replay finished games from season history. Browse every tracked
              hit by ballpark, or dig into team nerd stats. When Baseball Savant has a clip
              for a play, you can open it from play details and highlights.
            </p>
            <p>
              Predictions and odds are experimental model output for curiosity, NOT betting
              advice.
            </p>
            <p className="text-muted">
              Jump back to{" "}
              <Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
                Live
              </Link>
              ,{" "}
              <Link href="/games" className="font-medium text-foreground underline-offset-2 hover:underline">
                Season History
              </Link>
              ,{" "}
              <Link href="/ballparks" className="font-medium text-foreground underline-offset-2 hover:underline">
                Ballpark Hits
              </Link>
              , or{" "}
              <Link href="/nerd" className="font-medium text-foreground underline-offset-2 hover:underline">
                Nerd Standings
              </Link>
              .
            </p>
          </Section>

          <Section id="data" title="Data &amp; API attribution">
            <p>
              Game schedules, live feeds, box scores, and related stats come from the public{" "}
              <ExternalLink href="https://statsapi.mlb.com/">MLB Stats API</ExternalLink>{" "}
              (<span className="font-mono text-[12px] text-muted">statsapi.mlb.com</span>).
              Play video clips are resolved via{" "}
              <ExternalLink href="https://baseballsavant.mlb.com/">Baseball Savant</ExternalLink>{" "}
              sporty-video pages when a play GUID is available.
            </p>
            <p>
              Stadium geometry and related ballpark context draw on MLB-published field data
              and community resources such as{" "}
              <ExternalLink href="https://github.com/bdilday/GeomMLBStadiums">
                GeomMLBStadiums
              </ExternalLink>
              . Gameday-style images (stadium backgrounds, uniforms) are loaded from MLB
              static asset CDNs.
            </p>
            <p>
              Player headshots and deep links point to MLB.com. All MLB trademarks, logos,
              and media remain the property of MLB and its clubs. This site uses publicly
              available endpoints for informational and educational purposes; accuracy and
              availability are not guaranteed.
            </p>
            <p className="text-muted">
              If you represent a rights holder and need something adjusted, please reach
              out using the contact below.
            </p>
          </Section>

          <Section id="developer" title="About the developer">
            <p>
              Built by <span className="font-medium text-foreground">{DEVELOPER_NAME}</span>
              , a college student studying computer science and longtime Seattle resident
              swept up in the 2025 Mariners&apos; season; avidly followed baseball ever
              since.
            </p>
            <p>
              Feedback, bugs, and feature ideas are welcome at{" "}
              <a
                href={`mailto:${DEVELOPER_EMAIL}`}
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                {DEVELOPER_EMAIL}
              </a>
              . If {SITE_NAME_SHORT} is useful to you, you can{" "}
              <ExternalLink href={DONATE_URL}>buy me a coffee</ExternalLink>!
            </p>
            <p>
              Check out my other projects{" "}
              <ExternalLink href="https://kairui-cheng.vercel.app/">here</ExternalLink>!
            </p>
            <p className="text-muted">
              Source is released under the MIT License. Copyright © 2026 WTBB.
            </p>
          </Section>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-[11px] text-subtle">
        {SITE_NAME_SHORT} · Not affiliated with MLB
      </footer>
    </div>
  );
}
