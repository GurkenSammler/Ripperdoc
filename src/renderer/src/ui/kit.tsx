import { useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { play, type Sfx } from '../sfx'

/** Glitch beim Hover: Klasse kurz setzen, der SVG-Filter reißt das Element in horizontale Streifen. */
export function useGlitch<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const trigger = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.classList.remove('glitch-run')
    void el.offsetWidth
    el.classList.add('glitch-run')
  }, [])
  const onAnimationEnd = useCallback(() => ref.current?.classList.remove('glitch-run'), [])
  return { ref, trigger, onAnimationEnd }
}

export function Panel(props: {
  children: ReactNode
  className?: string
  innerClassName?: string
  tone?: 'accent' | 'alert' | 'deep'
  cut?: number
  style?: CSSProperties
  innerStyle?: CSSProperties
}) {
  const tone = props.tone ? ` panel--${props.tone}` : ''
  const style = { ...(props.cut ? ({ '--cut': `${props.cut}px` } as CSSProperties) : {}), ...props.style }
  return (
    <div className={`panel${tone} ${props.className ?? ''}`} style={style}>
      <div className={`panel__in ${props.innerClassName ?? ''}`} style={props.innerStyle}>
        {props.children}
      </div>
    </div>
  )
}

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'danger'
  size?: 'big' | 'small'
  disabled?: boolean
  title?: string
  sfx?: Sfx
  className?: string
}) {
  const g = useGlitch<HTMLButtonElement>()
  const cls = ['btn', props.variant && `btn--${props.variant}`, props.size && `btn--${props.size}`, props.className].filter(Boolean).join(' ')
  return (
    <button
      ref={g.ref}
      className={cls}
      disabled={props.disabled}
      title={props.title}
      onMouseEnter={() => {
        play('hover')
        g.trigger()
      }}
      onAnimationEnd={g.onAnimationEnd}
      onClick={() => {
        play(props.sfx ?? 'press')
        props.onClick?.()
      }}
    >
      <span>{props.children}</span>
    </button>
  )
}

export function Chip(props: { children: ReactNode; tone?: 'accent' | 'warn' | 'alert' | 'ok' | 'solid'; title?: string }) {
  return (
    <span className={`chip${props.tone ? ` chip--${props.tone}` : ''}`} title={props.title}>
      {props.children}
    </span>
  )
}

export function Switch(props: { on: boolean; onChange: (on: boolean) => void; title?: string; disabled?: boolean }) {
  return (
    <button
      className={`switch${props.on ? ' switch--on' : ''}`}
      title={props.title}
      disabled={props.disabled}
      onMouseEnter={() => play('hover')}
      onClick={(e) => {
        e.stopPropagation()
        play('press')
        props.onChange(!props.on)
      }}
      aria-pressed={props.on}
    />
  )
}

export function Micro(props: { children: ReactNode; accent?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span className={`micro${props.accent ? ' micro--accent' : ''} ${props.className ?? ''}`} style={props.style}>
      {props.children}
    </span>
  )
}

export function SectionHeader(props: { index: number; title: string; status?: ReactNode; active?: boolean }) {
  return (
    <div className={`section-head${props.active ? ' section-head--active' : ''}`}>
      <span className="section-head__sq" />
      <span className="section-head__idx">[{String(props.index).padStart(2, '0')}]</span>
      <span>{props.title}</span>
      <span className="section-head__rule" />
      {props.status !== undefined && <span className="section-head__status">{props.status}</span>}
    </div>
  )
}

export function HeaderLine() {
  return (
    <div className="header-line">
      <span className="header-line__hatch" />
    </div>
  )
}

/** Barcode-Streifen mit festen Zufallsbreiten (pro seed gleich). */
export function Barcode(props: { seed?: number; bars?: number }) {
  const widths = useMemo(() => {
    let s = props.seed ?? 7
    const out: number[] = []
    for (let i = 0; i < (props.bars ?? 22); i++) {
      s = (s * 9301 + 49297) % 233280
      out.push(1 + Math.floor((s / 233280) * 3))
    }
    return out
  }, [props.seed, props.bars])
  return (
    <span className="barcode">
      {widths.map((w, i) => (
        <i key={i} style={{ width: w }} />
      ))}
    </span>
  )
}

/** SVG-Filter für den Glitch: Rauschen nur entlang y → horizontale Bänder, harte Stufen, Versatz nur in x. */
export function GlitchFilters() {
  const filter = (id: string, seed: number, freq: number, scale: number) => (
    <filter id={id} x="-10%" y="0" width="120%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency={`0 ${freq}`} numOctaves={1} seed={seed} result="n" />
      <feComponentTransfer in="n" result="bands">
        <feFuncR type="discrete" tableValues="0.5 0.5 0.2 0.5 0.85 0.5 0.5 0.3 0.5 0.7" />
        <feFuncG type="table" tableValues="0.5 0.5" />
      </feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="bands" scale={scale} xChannelSelector="R" yChannelSelector="G" />
    </filter>
  )
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {filter('rd-g1', 3, 0.09, 18)}
        {filter('rd-g2', 11, 0.16, 26)}
        {filter('rd-g3', 29, 0.05, 12)}
      </defs>
    </svg>
  )
}

/** Hintergrund: Leiterbahnen mit 45°-Knicken und Eckmarken (wie im Attribut-Screen). */
export function Background() {
  const paths = useMemo(() => {
    let s = 2077
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    const out: string[] = []
    for (let i = 0; i < 11; i++) {
      let x = rnd() * 1600
      let y = rnd() * 1000
      let d = `M${x.toFixed(0)} ${y.toFixed(0)}`
      for (let k = 0; k < 4; k++) {
        const len = 60 + rnd() * 220
        const dir = Math.floor(rnd() * 4)
        if (dir === 0) x += len
        else if (dir === 1) y += len * 0.6
        else if (dir === 2) {
          x += len * 0.5
          y += len * 0.5
        } else {
          x += len * 0.5
          y -= len * 0.5
        }
        d += ` L${x.toFixed(0)} ${y.toFixed(0)}`
      }
      out.push(d)
    }
    return out
  }, [])
  return (
    <div className="bg">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        {paths.map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke="var(--primary-dim)" strokeOpacity={0.18} strokeWidth={1} />
            <circle cx={d.split(' ').slice(-2)[0].replace('L', '')} cy={d.split(' ').slice(-1)[0]} r={2.5} fill="var(--primary-dim)" fillOpacity={0.35} />
          </g>
        ))}
      </svg>
    </div>
  )
}

export function Scanlines() {
  return <div className="scanlines" />
}
