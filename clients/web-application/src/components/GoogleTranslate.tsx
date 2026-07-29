import { useEffect } from 'react'

/**
 * Google Translate API Types
 */
interface GoogleTranslateElementConstructor {
  new (options: GoogleTranslateOptions, elementId: string): void
  InlineLayout: {
    SIMPLE: number
  }
}

interface GoogleTranslateWindow extends Window {
  google?: {
    translate: {
      TranslateElement: GoogleTranslateElementConstructor
    }
  }
  googleTranslateElementInit?: () => void
}

interface GoogleTranslateOptions {
  pageLanguage: string
  includedLanguages: string
  layout: number
  autoDisplay: boolean
  gaTrack: boolean
  gaId: string
}

/**
 * Google Translate Integration Component
 * Adds language translation support to the frontend
 * Minimal, unobtrusive widget in the top-right corner
 */
export default function GoogleTranslate() {
  useEffect(() => {
    // Function to hide feedback elements
    const hideFeedbackElements = () => {
      // Hide feedback links and banners
      const selectors = [
        '.goog-te-banner-frame',
        '.goog-te-ftab-link',
        '.skiptranslate',
        'body > .skiptranslate',
        'body > .goog-te-banner-frame',
        '.goog-te-gadget a[href*="translate.google.com"]',
        'iframe[name="google_translate_element"]',
      ]
      
      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector)
        elements.forEach((el: Element) => {
          const element = el as HTMLElement
          element.style.display = 'none'
          element.style.visibility = 'hidden'
          element.style.height = '0'
          element.style.width = '0'
          element.style.opacity = '0'
          element.style.overflow = 'hidden'
        })
      })
    }

    // Hide feedback elements periodically (they're added dynamically)
    const interval = setInterval(hideFeedbackElements, 500)

    // Load Google Translate script
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    script.async = true
    document.head.appendChild(script)

    // Initialize Google Translate
    const win = window as unknown as GoogleTranslateWindow
    win.googleTranslateElementInit = () => {
      if (win.google?.translate) {
        try {
          new win.google.translate.TranslateElement(
            {
              pageLanguage: 'en',
              includedLanguages: 'en,es,fr,de,it,pt,ru,zh-CN,ja,ko,ar,hi,tr,pl,nl,sv,fi,no,da,cs,hu,ro,bg,hr,sk,sl,et,lv,lt',
              layout: win.google.translate.TranslateElement.InlineLayout.SIMPLE,
              autoDisplay: false,
              gaTrack: false,
              gaId: '',
            },
            'google_translate_element'
          )
          
          // Hide feedback elements after initialization
          setTimeout(hideFeedbackElements, 1000)
        } catch (error) {
          console.error('Google Translate initialization failed:', error)
        }
      }
    }

    return () => {
      clearInterval(interval)
      // Cleanup
      const existing = document.querySelector('script[src*="translate.google.com"]')
      if (existing) existing.remove()
      const widget = document.getElementById('google_translate_element')
      if (widget) widget.innerHTML = ''
    }
  }, [])

  return (
    <div 
      id="google_translate_element" 
      className="fixed top-4 right-4 z-50"
      aria-label="Select language"
    />
  )
}

