import { createRoot } from 'react-dom/client'
import { resolveLang, setLang } from '@shared/i18n'
import { App } from './App'
import './styles/theme.css'
import './styles/ui.css'
import './styles/app.css'

// Bis die Einstellungen da sind: Sprache des Systems
setLang(resolveLang('auto', navigator.languages))

createRoot(document.getElementById('root')!).render(<App />)
