'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunActionName } from '@smartqa/shared/schemas';
import type { TestRun } from '@smartqa/shared/types';
import {
  Eye,
  Hand,
  Loader2,
  LogIn,
  MousePointerClick,
  Pause,
  Play,
  Square,
  Undo2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { api, liveStreamUrl, type LiveSessionInfo } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ViewportSize {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

type StreamEvent =
  | { type: 'frame'; data: string; at: string }
  | { type: 'status'; interactive: boolean; status: string };

function parseStreamEvent(raw: string): StreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as {
      type?: unknown;
      data?: unknown;
      at?: unknown;
      interactive?: unknown;
      status?: unknown;
    };
    if (candidate.type === 'frame' && typeof candidate.data === 'string') {
      return {
        type: 'frame',
        data: candidate.data,
        at: typeof candidate.at === 'string' ? candidate.at : new Date().toISOString(),
      };
    }
    if (candidate.type === 'status') {
      return {
        type: 'status',
        interactive: candidate.interactive === true,
        status: typeof candidate.status === 'string' ? candidate.status : 'unknown',
      };
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_TYPE_CHARS = 4_000;

const SPECIAL_KEYS: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

function fallbackViewport(run: TestRun): ViewportSize {
  const mobileOnly =
    run.config.viewports.length === 1 && run.config.viewports[0] === 'mobile';
  return mobileOnly ? { width: 390, height: 844 } : { width: 1440, height: 900 };
}

function isTerminal(run: TestRun): boolean {
  return run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';
}

function overlayState(run: TestRun, interactive: boolean): { label: string; hint: string; dot: string; tone: string } {
  if (run.status === 'awaiting_login') {
    return {
      label: 'Awaiting manual sign-in',
      hint: 'Sign in inside the viewport, then choose “Sign-in complete — start testing”.',
      dot: 'bg-severity-medium',
      tone: 'border-severity-medium/40 bg-severity-medium/15 text-severity-medium',
    };
  }
  if (run.status === 'paused') {
    return {
      label: 'Paused',
      hint: 'Execution is paused. Resume to let the agent continue.',
      dot: 'bg-severity-high',
      tone: 'border-severity-high/40 bg-severity-high/15 text-severity-high',
    };
  }
  if (isTerminal(run)) {
    return {
      label: 'Stopped',
      hint: 'This run has finished. The recording is no longer live.',
      dot: 'bg-muted-foreground',
      tone: 'border-border bg-background/70 text-muted-foreground',
    };
  }
  if (run.status === 'running') {
    return interactive
      ? {
          label: 'You have control',
          hint: 'Clicks, wheel and keyboard input are forwarded to the browser.',
          dot: 'bg-brand',
          tone: 'border-brand/40 bg-brand/15 text-brand',
        }
      : {
          label: 'Agent is testing',
          hint: 'Take control to interact with the browser yourself.',
          dot: 'bg-violetBrand',
          tone: 'border-violetBrand/40 bg-violetBrand/15 text-violetBrand',
        };
  }
  if (run.status === 'finalizing') {
    return {
      label: 'Finalizing',
      hint: 'The agent is collecting the report and evidence.',
      dot: 'bg-violetBrand',
      tone: 'border-violetBrand/40 bg-violetBrand/15 text-violetBrand',
    };
  }
  return {
    label: 'Preparing browser',
    hint: 'The browser session is starting up.',
    dot: 'bg-violetBrand',
    tone: 'border-violetBrand/40 bg-violetBrand/15 text-violetBrand',
  };
}

export interface LiveBrowserProps {
  run: TestRun;
  session: LiveSessionInfo | null;
  className?: string;
  onRunChanged: () => void;
}

export function LiveBrowser({ run, session, className, onRunChanged }: LiveBrowserProps) {
  const sessionId = session?.id ?? null;
  const viewport: ViewportSize = session?.viewport ?? fallbackViewport(run);

  const [frame, setFrame] = useState<string | null>(null);
  const [frameAt, setFrameAt] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [interactive, setInteractive] = useState<boolean>(session?.interactive ?? false);
  const [busyAction, setBusyAction] = useState<RunActionName | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pressedRef = useRef(false);
  const lastPointRef = useRef<Point>({ x: 0, y: 0 });
  const lastMoveAtRef = useRef(0);
  const pendingMoveRef = useRef<Point | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeBufferRef = useRef('');
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputErrorAtRef = useRef(0);

  const terminal = isTerminal(run);
  const canInteract = (interactive || run.status === 'awaiting_login') && !terminal;

  useEffect(() => {
    if (session) setInteractive(session.interactive);
  }, [session?.id, session?.interactive]);

  const send = useCallback(
    (input: Parameters<typeof api.sendLiveInput>[1]) => {
      if (!sessionId) return;
      void api.sendLiveInput(sessionId, input).catch((cause: unknown) => {
        const now = Date.now();
        if (now - lastInputErrorAtRef.current < 3_000) return;
        lastInputErrorAtRef.current = now;
        setActionError(
          cause instanceof Error
            ? cause.message
            : 'Could not forward input to the live browser.',
        );
      });
    },
    [sessionId],
  );

  const dispatchStreamEvent = useCallback((raw: string) => {
    const event = parseStreamEvent(raw);
    if (!event) return;
    if (event.type === 'frame') {
      setFrame(`data:image/jpeg;base64,${event.data}`);
      setFrameAt(event.at);
      setStreamState('live');
    } else {
      setInteractive(event.interactive);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const source = new EventSource(liveStreamUrl(sessionId));
    const handleDefault = (message: MessageEvent<string>) => {
      if (typeof message.data === 'string') dispatchStreamEvent(message.data);
    };
    const handleNamed = (message: Event) => {
      if (message instanceof MessageEvent && typeof message.data === 'string') {
        dispatchStreamEvent(message.data);
      }
    };

    source.onopen = () => setStreamState('live');
    source.onerror = () => setStreamState('error');
    source.onmessage = handleDefault;
    source.addEventListener('frame', handleNamed);
    source.addEventListener('status', handleNamed);

    return () => {
      source.removeEventListener('frame', handleNamed);
      source.removeEventListener('status', handleNamed);
      source.close();
    };
  }, [sessionId, dispatchStreamEvent]);

  const flushMove = useCallback(() => {
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    lastMoveAtRef.current = Date.now();
    send({
      type: 'mouse',
      event: 'mouseMoved',
      x: pending.x,
      y: pending.y,
      button: 'none',
      clickCount: 0,
      modifiers: 0,
    });
  }, [send]);

  useEffect(
    () => () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    },
    [],
  );

  const sendText = useCallback(
    (text: string) => {
      if (text.length === 0) return;
      for (let offset = 0; offset < text.length; offset += MAX_TYPE_CHARS) {
        send({ type: 'type', text: text.slice(offset, offset + MAX_TYPE_CHARS) });
      }
    },
    [send],
  );

  const flushTypeBuffer = useCallback(() => {
    const text = typeBufferRef.current;
    typeBufferRef.current = '';
    sendText(text);
  }, [sendText]);

  const queueCharacter = (character: string) => {
    typeBufferRef.current += character;
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    typeTimerRef.current = setTimeout(() => {
      typeTimerRef.current = null;
      flushTypeBuffer();
    }, 60);
  };

  const toPoint = (clientX: number, clientY: number): Point => {
    const node = containerRef.current;
    if (!node) return { x: 0, y: 0 };
    const rect = node.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    const rawX = ((clientX - rect.left) / width) * viewport.width;
    const rawY = ((clientY - rect.top) / height) * viewport.height;
    return {
      x: Math.min(viewport.width - 1, Math.max(0, Math.round(rawX))),
      y: Math.min(viewport.height - 1, Math.max(0, Math.round(rawY))),
    };
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    textareaRef.current?.focus({ preventScroll: true });
    const point = toPoint(event.clientX, event.clientY);
    lastPointRef.current = point;
    pressedRef.current = true;
    send({
      type: 'mouse',
      event: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
      modifiers: 0,
    });
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!canInteract) return;
    event.preventDefault();
    const point = toPoint(event.clientX, event.clientY);
    lastPointRef.current = point;
    send({
      type: 'mouse',
      event: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 2,
      modifiers: 0,
    });
    send({
      type: 'mouse',
      event: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 2,
      modifiers: 0,
    });
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!canInteract) return;
    const point = toPoint(event.clientX, event.clientY);
    lastPointRef.current = point;
    const now = Date.now();
    const elapsed = now - lastMoveAtRef.current;
    if (elapsed >= 33) {
      lastMoveAtRef.current = now;
      pendingMoveRef.current = null;
      send({
        type: 'mouse',
        event: 'mouseMoved',
        x: point.x,
        y: point.y,
        button: 'none',
        clickCount: 0,
        modifiers: 0,
      });
      return;
    }
    pendingMoveRef.current = point;
    if (moveTimerRef.current == null) {
      moveTimerRef.current = setTimeout(() => {
        moveTimerRef.current = null;
        flushMove();
      }, 33 - elapsed);
    }
  };

  useEffect(() => {
    if (!canInteract) return;
    const handleWindowMouseUp = () => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      const point = lastPointRef.current;
      send({
        type: 'mouse',
        event: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
        modifiers: 0,
      });
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, [canInteract, send]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      if (!canInteract) return;
      event.preventDefault();
      const point = toPoint(event.clientX, event.clientY);
      send({
        type: 'mouse',
        event: 'mouseWheel',
        x: point.x,
        y: point.y,
        button: 'none',
        clickCount: 0,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        modifiers: 0,
      });
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [canInteract, send, viewport.width, viewport.height]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!canInteract) return;
    event.preventDefault();
    const code = SPECIAL_KEYS[event.key];
    if (code) {
      send({ type: 'key', event: 'keyDown', key: event.key, code, modifiers: 0 });
      if (event.key === 'Escape') textareaRef.current?.blur();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      queueCharacter(event.key);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canInteract) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    if (text.length > 0) sendText(text);
  };

  const runAction = async (action: RunActionName) => {
    setBusyAction(action);
    setActionError(null);
    try {
      await api.runAction(run.id, { action });
      if (action === 'takeover') setInteractive(true);
      if (action === 'release') setInteractive(false);
      onRunChanged();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : 'The run action could not be applied.',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const overlay = overlayState(run, interactive);
  const controlsDisabled = busyAction != null;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-hidden rounded-lg border border-border bg-black/50">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {streamState === 'error' ? (
                <>
                  <WifiOff className="h-3 w-3 text-severity-medium" />
                  reconnecting
                </>
              ) : streamState === 'live' ? (
                <>
                  <Wifi className="h-3 w-3 text-success" />
                  stream live
                </>
              ) : (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  connecting
                </>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {session?.viewerCount ?? 0} watching
            </span>
            <span>
              {viewport.width}×{viewport.height}
            </span>
            {frameAt ? <span>frame {formatTime(frameAt)}</span> : null}
          </div>
        </div>

        <div
          ref={containerRef}
          className={cn(
            'relative overflow-hidden bg-[#05080c]',
            canInteract ? 'cursor-crosshair' : 'cursor-default',
          )}
          style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
          onContextMenu={(event) => {
            if (canInteract) event.preventDefault();
          }}
        >
          {frame ? (
            <img
              src={frame}
              alt="Live browser viewport"
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onDoubleClick={handleDoubleClick}
              className="absolute inset-0 h-full w-full select-none object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
              <Skeleton className="h-full w-full opacity-40" />
              <span className="absolute flex flex-col items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {streamState === 'error'
                  ? 'Reconnecting to the live stream…'
                  : session
                    ? 'Waiting for the first frame…'
                    : 'Preparing the live session…'}
              </span>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-2 top-2 flex flex-wrap items-start justify-between gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wide backdrop-blur',
                overlay.tone,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', overlay.dot, canInteract && 'animate-pulse')} />
              {overlay.label}
            </span>
          </div>

          {canInteract ? (
            <span className="pointer-events-none absolute inset-x-2 bottom-2 flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[10px] text-white/80 backdrop-blur">
                <MousePointerClick className="h-3 w-3" />
                Click, scroll and type — Escape releases keyboard focus
              </span>
            </span>
          ) : null}
        </div>

        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          aria-label="Live browser keyboard input"
          autoComplete="off"
          spellCheck={false}
          className="sr-only"
        />
      </div>

      {actionError ? (
        <Alert variant="destructive">
          <WifiOff />
          <AlertTitle>Live control error</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {run.status === 'queued' ? (
          <Button size="sm" variant="brand" onClick={() => void runAction('start')} disabled={controlsDisabled}>
            {busyAction === 'start' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start run
          </Button>
        ) : null}

        {run.status === 'running' ? (
          <Button size="sm" variant="outline" onClick={() => void runAction('pause')} disabled={controlsDisabled}>
            {busyAction === 'pause' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
            Pause
          </Button>
        ) : null}

        {run.status === 'paused' ? (
          <Button size="sm" variant="outline" onClick={() => void runAction('resume')} disabled={controlsDisabled}>
            {busyAction === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Resume
          </Button>
        ) : null}

        {!terminal ? (
          <Button size="sm" variant="outline" onClick={() => void runAction('stop')} disabled={controlsDisabled}>
            {busyAction === 'stop' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop
          </Button>
        ) : null}

        {!terminal && !interactive ? (
          <Button size="sm" variant="secondary" onClick={() => void runAction('takeover')} disabled={controlsDisabled}>
            {busyAction === 'takeover' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Hand className="h-3.5 w-3.5" />
            )}
            Take control
          </Button>
        ) : null}

        {!terminal && interactive ? (
          <Button size="sm" variant="secondary" onClick={() => void runAction('release')} disabled={controlsDisabled}>
            {busyAction === 'release' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
            Release control
          </Button>
        ) : null}

        {run.status === 'awaiting_login' ? (
          <Button size="sm" variant="brand" onClick={() => void runAction('login_complete')} disabled={controlsDisabled}>
            {busyAction === 'login_complete' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogIn className="h-3.5 w-3.5" />
            )}
            Sign-in complete — start testing
          </Button>
        ) : null}

        {run.mode === 'live' && !terminal ? (
          <Button size="sm" variant="ghost" onClick={() => void runAction('detach')} disabled={controlsDisabled}>
            {busyAction === 'detach' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            Continue in background
          </Button>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {overlay.hint} Mouse coordinates are mapped from the rendered image to the {viewport.width}×
        {viewport.height} viewport; keystrokes are batched and forwarded to the focused page.
      </p>
    </div>
  );
}
