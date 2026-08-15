import { useEffect, useRef, useState, type FormEvent } from "react";
import { Capacitor } from "@capacitor/core";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  ClipboardCopyIcon,
  Cross2Icon,
  DownloadIcon,
  FileIcon,
  Link2Icon,
  LockClosedIcon,
  PauseIcon,
  PlayIcon,
  SpeakerLoudIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import {
  MediaDownloader,
  type NativeDownloadResult,
} from "./native/mediaDownloader";

type Format = "mp3" | "mp4";
type DownloadStatus = "idle" | "preparing" | "downloading" | "complete";

const sampleUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function isYouTubeUrl(value: string) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(value.trim());
}

export default function KeepItApp() {
  const keyboard = useKeyboard();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nativeRunRef = useRef(0);
  const isNative = Capacitor.isNativePlatform();
  const useNativeLayout = isNative || (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("nativePreview") === "1"
  );
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<Format>("mp3");
  const [status, setStatus] = useState<DownloadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [nativeResult, setNativeResult] = useState<NativeDownloadResult | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("native-app", useNativeLayout);
    return () => document.documentElement.classList.remove("native-app");
  }, [useNativeLayout]);

  useEffect(() => {
    if (!isNative) return;

    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    void MediaDownloader.addListener("downloadProgress", (event) => {
      if (event.status === "preparing") {
        setStatus("preparing");
        setProgress(0);
        return;
      }
      if (event.status === "downloading") {
        setStatus("downloading");
        setProgress(event.progress);
        return;
      }
      setProgress(100);
    }).then((handle) => {
      if (disposed) void handle.remove();
      else removeListener = () => handle.remove();
    });

    return () => {
      disposed = true;
      if (removeListener) void removeListener();
    };
  }, [isNative]);

  useEffect(() => {
    if (isNative || status !== "preparing") return;

    const timer = window.setTimeout(() => {
      setStatus("downloading");
      setProgress(8);
    }, 750);

    return () => window.clearTimeout(timer);
  }, [isNative, status]);

  useEffect(() => {
    if (isNative || status !== "downloading") return;

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(100, current + 11);
        if (next === 100) {
          window.clearInterval(timer);
          setStatus("complete");
          setToast(`${format.toUpperCase()} saved to Downloads`);
        }
        return next;
      });
    }, 280);

    return () => window.clearInterval(timer);
  }, [format, isNative, status]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function pasteLink() {
    let nextValue = sampleUrl;

    try {
      const clipboardValue = await navigator.clipboard.readText();
      if (clipboardValue.trim()) nextValue = clipboardValue.trim();
    } catch {
      setToast("Sample link pasted");
    }

    setUrl(nextValue);
    setError("");
    inputRef.current?.focus();
  }

  function startDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    keyboard.hide();
    inputRef.current?.blur();

    if (!url.trim()) {
      setError("Paste a YouTube link to continue.");
      inputRef.current?.focus();
      return;
    }

    if (!isYouTubeUrl(url)) {
      setError("That doesn’t look like a YouTube link.");
      inputRef.current?.focus();
      return;
    }

    setError("");
    setNativeResult(null);
    setProgress(0);
    setStatus("preparing");

    if (isNative) {
      const run = nativeRunRef.current + 1;
      nativeRunRef.current = run;
      void MediaDownloader.download({ url: url.trim(), format })
        .then((result) => {
          if (nativeRunRef.current !== run) return;
          setNativeResult(result);
          setProgress(100);
          setStatus("complete");
          setToast(`${format.toUpperCase()} saved to Downloads/KeepIt`);
        })
        .catch((downloadError: { code?: string; message?: string }) => {
          if (nativeRunRef.current !== run) return;
          setProgress(0);
          setStatus("idle");
          if (downloadError.code !== "CANCELLED") {
            setError(downloadError.message || "The download could not be completed.");
          }
        });
    }
  }

  function cancelDownload() {
    nativeRunRef.current += 1;
    if (isNative) void MediaDownloader.cancel();
    setStatus("idle");
    setProgress(0);
    setToast("Download cancelled");
  }

  function openDownloads() {
    if (isNative) {
      void MediaDownloader.openDownloads();
      return;
    }
    setToast("Opening Downloads");
  }

  function formattedSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const savedTitle = nativeResult
    ? nativeResult.fileName.replace(/\.[^.]+$/, "").replaceAll("_", " ")
    : "Your saved video";

  const isBusy = status === "preparing" || status === "downloading";

  return (
    <MobileScroll className="app-screen keepit-scroll">
      <main className="keepit-screen" aria-label="KeepIt media downloader">
        <header className="hero-copy">
          <p className="eyebrow">KEEPIT</p>
          <h1>Save media.<br />Keep it yours.</h1>
          <p className="hero-description">
            Download videos you own or are authorized to save as MP3 or MP4 to your Downloads.
          </p>
        </header>

        <form className="download-form" onSubmit={startDownload} noValidate>
          <label className="url-field" htmlFor="video-url">
            <span className="field-label">Paste a video link</span>
            <span className={`input-shell ${error ? "input-shell-error" : ""}`}>
              <Link2Icon className="field-icon" aria-hidden="true" />
              <KeyboardInput
                ref={inputRef}
                id="video-url"
                data-testid="video-url"
                value={url}
                onChange={(event) => {
                  setUrl(event.currentTarget.value);
                  if (error) setError("");
                }}
                onBlur={() => keyboard.hide()}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="youtube.com/watch?v=…"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "url-error" : undefined}
              />
              <button className="paste-button" type="button" onClick={pasteLink} aria-label="Paste video link">
                <ClipboardCopyIcon aria-hidden="true" />
                <span>Paste</span>
              </button>
            </span>
            {error && <span className="field-error" id="url-error" role="alert">{error}</span>}
          </label>

          <fieldset className="format-fieldset">
            <legend>Choose format</legend>
            <div className="format-switch" role="radiogroup" aria-label="Download format">
              <button
                className={format === "mp3" ? "format-option selected" : "format-option"}
                type="button"
                role="radio"
                aria-checked={format === "mp3"}
                onClick={() => setFormat("mp3")}
              >
                <SpeakerLoudIcon aria-hidden="true" />
                <span>MP3</span>
              </button>
              <button
                className={format === "mp4" ? "format-option selected" : "format-option"}
                type="button"
                role="radio"
                aria-checked={format === "mp4"}
                onClick={() => setFormat("mp4")}
              >
                <VideoIcon aria-hidden="true" />
                <span>MP4</span>
              </button>
            </div>
          </fieldset>

          <button className="continue-button" type="submit" disabled={isBusy}>
            {status === "preparing" ? (
              <><DownloadIcon className="button-icon pulse" aria-hidden="true" /><span>Preparing…</span></>
            ) : status === "downloading" ? (
              <><PauseIcon className="button-icon" aria-hidden="true" /><span>{progress}% downloaded</span></>
            ) : (
              <><span>{status === "complete" ? "Download another" : "Continue"}</span><ArrowRightIcon className="button-icon" aria-hidden="true" /></>
            )}
          </button>
        </form>

        <section className="recent-section" aria-labelledby="recent-title">
          <div className="section-heading-row">
            <h2 id="recent-title">Recent download</h2>
            <button type="button" onClick={() => setToast("All downloads are stored locally")}>View all <ArrowRightIcon aria-hidden="true" /></button>
          </div>

          <article className="download-row" aria-live="polite">
            <div className="thumbnail-wrap">
              <img src="/assets/app/morning-mountains.png" alt="Mountain lake at sunrise" draggable={false} />
              <span className="play-badge" aria-hidden="true"><PlayIcon /></span>
            </div>
            <div className="download-details">
              <h3>{status === "idle" ? "Morning in the Mountains" : savedTitle}</h3>
              <p>{format.toUpperCase()} <span>•</span> {format === "mp3" ? "320 kbps" : "1080p"} <span>•</span> {nativeResult ? formattedSize(nativeResult.sizeBytes) : format === "mp3" ? "8.4 MB" : "42.7 MB"}</p>
              {isBusy ? (
                <div className="progress-block">
                  <div className="progress-track" aria-label={`Download ${progress}% complete`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                    <span style={{ width: `${Math.max(4, progress)}%` }} />
                  </div>
                  <small>{status === "preparing" ? "Checking available formats…" : "Saving to Downloads…"}</small>
                </div>
              ) : (
                <p className={status === "complete" ? "download-status complete" : "download-status"}>
                  {status === "complete" && <CheckCircledIcon aria-hidden="true" />}
                  {status === "complete" ? "Saved to Downloads" : "Downloaded just now"}
                </p>
              )}
            </div>
            <button
              className="row-action"
              type="button"
              aria-label={isBusy ? "Cancel download" : "Open Downloads"}
              onClick={isBusy ? cancelDownload : openDownloads}
            >
              {isBusy ? <Cross2Icon aria-hidden="true" /> : <FileIcon aria-hidden="true" />}
            </button>
          </article>
        </section>

        <aside className="permission-note">
          <span className="permission-icon" aria-hidden="true"><LockClosedIcon /></span>
          <p>Only download content you own or have permission to save. Respect creators and copyright laws.</p>
        </aside>

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    </MobileScroll>
  );
}
