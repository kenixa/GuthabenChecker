// ==UserScript==
// @name            Guthaben Checker (Beta)
// @namespace       http://tampermonkey.net/
// @version         2.1.0
// @description     Checkt Guthabenseiten
// @author          kenixa
// @match           https://www.eneba.com/*
// @match           https://www.kinguin.net/*
// @match           https://www.gamivo.com/*
// @match           https://driffle.com/*
// @updateURL       https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @downloadURL     https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @connect         raw.githubusercontent.com
// @grant           GM_xmlhttpRequest
// @connect         api.exchangerate-api.com
// ==/UserScript==

(function () {
    'use strict';

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    const STYLES = {
        colors: {
            errorColorBg: 'rgba(220, 53, 69, 0.9)',
            orientationBg: '#27293a',
            infoBg: '#27293a'
        },
        fonts: {
            default: "'Roboto', sans-serif",
        }
    };
    const siteConfig = {
        'eneba.com': {
            paymentPageUrl: (window.location.href.includes('/de') ? "https://www.eneba.com/de/checkout/payment" : "https://www.eneba.com/checkout/payment"),
            getElements: () => {
                let paymentMethodClassElement = null;
                let selectedProducts = [];

                try {
                    const totalLabelElement = [...document.querySelectorAll('*')]
                    .find(el =>
                          Array.from(el.childNodes).some(node => {
                        if (node.nodeType !== Node.TEXT_NODE) {
                            return false;
                        }
                        const trimmedText = node.textContent.trim();
                        const lowerTrimmedText = trimmedText.toLowerCase();

                        if (trimmedText.startsWith('Total')) {
                            return !lowerTrimmedText.includes('available balance');
                        }
                        if (trimmedText.startsWith('Gesamt')) {
                            return true;
                        }
                        return false;
                    })
                         );

                    paymentMethodClassElement = totalLabelElement?.querySelector('div')?.querySelector('span') ?? null;

                    selectedProducts = [...document.querySelectorAll('span')]
                        .filter(span => {
                        const text = span.textContent.trim();
                        if (!/^\d+$/.test(text) || parseInt(text, 10) <= 0) return false;
                        const prevSibling = span.previousElementSibling;
                        const nextSibling = span.nextElementSibling;

                        return prevSibling?.tagName === 'BUTTON' && prevSibling.textContent.includes('-') &&
                            nextSibling?.tagName === 'BUTTON' && nextSibling.textContent.includes('+');
                    });

                } catch (e) {
                    paymentMethodClassElement = null;
                    selectedProducts = [];
                }


                return { paymentMethodClassElement, selectedProducts };
            },
        },

        'kinguin.net': {
            paymentPageUrl: "/new-checkout/review",
            getElements: () => {
                const totalElements = [...document.querySelectorAll('*')].filter(el =>
                                                                                 ['Gesamtsumme', 'Grand total'].includes(el.textContent.trim())
                                                                                );

                const summarySection = document.getElementById("summarySection");
                const relevantTotalElement = summarySection
                ? totalElements.find(el => summarySection.contains(el))
                : totalElements[0];

                const paymentMethodClassElement = relevantTotalElement?.closest('span')?.nextElementSibling ||
                      relevantTotalElement?.closest('span')?.querySelector('.price-mobile');

                const quantityInputs = [...document.querySelectorAll('input[type="number"][data-test="quantityInput"]')];

                return {
                    paymentMethodClassElement: paymentMethodClassElement,
                    selectedProducts: quantityInputs,
                };
            },
        },

        'gamivo.com': {
            getElements: () => {
                const isPaymentPage = window.location.pathname.includes('/payments');
                let paymentMethodClassElement = null;
                let productCountElements = [];

                if (isPaymentPage) {
                    paymentMethodClassElement = document.querySelector('div[data-testid="cart-summary__total-to-pay"] > div:last-child');

                    productCountElements = [];

                } else {
                    paymentMethodClassElement = [...document.querySelectorAll('*')]
                        .find(el => el.textContent.trim() === "Total" || el.textContent.trim() === "Insgesamt")?.nextElementSibling;

                    const productCountInput = document.querySelector('input[data-testid="cart-products__count"]');
                    if (productCountInput) {
                        productCountElements = [productCountInput];

                        const currentQuantity = parseInt(productCountInput.value, 10) || 0;
                        if (currentQuantity > 0) {
                            sessionStorage.setItem('guthabenChecker_gamivoQuantity', currentQuantity);
                        } else {
                            sessionStorage.removeItem('guthabenChecker_gamivoQuantity');
                        }
                    } else {
                        sessionStorage.removeItem('guthabenChecker_gamivoQuantity');
                        productCountElements = [];
                    }
                }
                return {
                    paymentMethodClassElement: paymentMethodClassElement,
                    selectedProducts: productCountElements,
                };
            },
        },

        'driffle.com': {
            paymentPageUrl: (window.location.href.includes('/de') ? "https://driffle.com/de/checkout" : "https://driffle.com/checkout"),
            getElements: () => {
                let paymentMethodClassElement = null;
                let productCountElement = null;

                try {
                    const totalLabelElement = [...document.querySelectorAll('p')]
                    .find(p => ['Total', 'Gesamtbetrag'].includes(p.textContent.trim()));

                    if (totalLabelElement) {
                        paymentMethodClassElement = totalLabelElement.nextElementSibling?.querySelector('p');

                    } else {
                    }

                    const allElements = document.querySelectorAll('*');
                    const productCountElements = [...allElements].filter(element => {
                        const text = element.innerText?.trim();
                        return text && /^\d+$/.test(text) && parseInt(text, 10) > 0;
                    });
                    if (productCountElements.length > 0) {
                        productCountElement = productCountElements[productCountElements.length - 1];
                    } else {
                    }
                } catch (e) {
                }

                return {
                    paymentMethodClassElement: paymentMethodClassElement,
                    selectedProducts: productCountElement ? [productCountElement] : [],
                };
            },
        }
    };

    // ========================================================================
    // Products
    // ========================================================================

    let products = {}; // Wird nach dem Laden gefüllt
    const CATEGORIES = Array.from({ length: 2000 }, (_, i) => (i + 1).toString());

    async function fetchProductsConfig() {
        const url = `https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/products.json?v=${new Date().getTime()}`;

        try {
            const response = await fetch(url, { cache: "no-cache" });

            if (!response.ok) {
                throw new Error(`HTTP-Status ${response.status}`);
            }

            const loadedProducts = await response.json();

            for (const key in loadedProducts) {
                if (loadedProducts[key].text) {
                    const textTemplates = loadedProducts[key].text;
                    loadedProducts[key].text = (c) => textTemplates.map(template => template.replace(/\$\{c\}/g, c));
                }
            }
            products = loadedProducts;
            console.log("GuthabenChecker: Produkt-Konfiguration frisch via fetch() geladen.");

        } catch (error) {
            console.error("GuthabenChecker: Kritischer Fehler beim Laden der Konfiguration.", error);
            throw error;
        }
    }
    // ========================================================================
    // Gutscheincodes
    // ========================================================================

    const voucherCodes = {
        Kinguin: 'Lade...',
        Eneba: 'Lade...',
        Driffle: 'Lade...',
        Gamivo: 'PRPX'
    };
    async function fetchVoucherCodes() {
        const url = `https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/vouchers.txt?v=${new Date().getTime()}`;
        try {
            const response = await fetch(url, { cache: "no-cache" });
            if (!response.ok) {
                throw new Error(`HTTP-Status ${response.status}`);
            }
            const text = await response.text();

            text.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length === 2) {
                    const store = parts[0].trim();
                    const code = parts[1].trim();
                    if (voucherCodes.hasOwnProperty(store)) {
                        voucherCodes[store] = code;
                    }
                }
            });
            console.log("GuthabenChecker: Gutscheincodes erfolgreich geladen.", voucherCodes);

        } catch (error) {
            console.error("GuthabenChecker: Fehler beim Laden der Gutscheincodes.", error);
            for (const store in voucherCodes) {
                if (voucherCodes[store] === 'Lade...') {
                    voucherCodes[store] = 'Fehler';
                }
            }
        }
    }

    async function main() {
        try {
            await fetchProductsConfig();
            await fetchVoucherCodes();
        } catch (error) {
            console.error("GuthabenChecker: Skript konnte wegen Konfigurationsfehler nicht gestartet werden.");
            return;
        }

        // ========================================================================
        // GLOBAL STATE VARIABLES
        // ========================================================================

        let previousState = null;
        let userClosedWindow = false;
        let tryDayPrice = 0.024;

        const currentSite = window.location.hostname.includes('kinguin') ? 'kinguin.net'
        : window.location.hostname.includes('gamivo') ? 'gamivo.com'
        : window.location.hostname.includes('driffle') ? 'driffle.com'
        : 'eneba.com';
        const config = siteConfig[currentSite];

        // ========================================================================
        // API & DATA FETCHING FUNCTIONS
        // ========================================================================

        const fetchExchangeRate = async () => {
            try {
                const response = await fetch('https://api.exchangerate-api.com/v4/latest/TRY');
                if (!response.ok) throw new Error(`API-Anfrage fehlgeschlagen: ${response.status}`);
                const data = await response.json();
                if (data && data.rates && data.rates.EUR) {
                    tryDayPrice = data.rates.EUR;
                } else {
                }
            } catch (error) {
            }
        };

        fetchExchangeRate();
        setInterval(fetchExchangeRate, 30 * 60 * 1000);

        // ========================================================================
        // PriceHelperFunctions
        // ========================================================================

        const determinePriceCategoryEUR = (factor, thresholds) => {
            if (factor <= thresholds[0]) return 'Top';
            if (factor <= thresholds[1]) return 'Gut';
            if (factor <= thresholds[2]) return 'Okay';
            return 'Schlecht';
        };

        const getOrientationTextEUR = (category, productCount, product) => {
            const numericCategory = parseFloat(category);
            const prices = product.factors.map(factor => factor * numericCategory * productCount);
            const okayPrice = prices[2];
            prices[3] = okayPrice + 0.01;
            const formattedPrices = prices.map(price => formatPriceForDisplay(price));
            const priceLabels = ['Top', 'Gut', 'Okay', 'Schlecht'];
            const priceTexts = formattedPrices.map((price, index) => `${index === 3 ? 'ab' : 'bis'} ${price} = <b>${priceLabels[index]}</b>`);
            return priceTexts.join(' | ');
        };

        const determinePriceCategoryTRY = (factor, thresholds) => {
            if (factor <= thresholds[0]) return 'Top';
            if (factor <= thresholds[1]) return 'Gut';
            if (factor <= thresholds[2]) return 'Okay';
            return 'Schlecht';
        };

        const getOrientationTextTRY = (category, productCount, product) => {
            const numericCategory = parseFloat(category);
            const prices = product.factors.map(factor => factor * numericCategory * productCount * tryDayPrice);
            const okayPrice = prices[2];
            prices[3] = okayPrice + 0.01;

            const formattedPrices = prices.map(price => formatPriceForDisplay(price));
            const priceLabels = ['Top', 'Gut', 'Okay', 'Schlecht'];
            const priceTexts = formattedPrices.map((price, index) => `${index === 3 ? 'ab' : 'bis'} ${price} = <b>${priceLabels[index]}</b>`);
            return priceTexts.join(' | ');
        };

        const formatPriceForDisplay = (price) => {
            const priceString = String(price);
            const parts = priceString.split('.');
            let formattedPrice = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            if (parts.length > 1) {
                formattedPrice += ',' + (parts[1].length === 1 ? parts[1] + '0' : parts[1].substring(0, 2));
            } else {
                formattedPrice += ',00';
            }
            return formattedPrice + '€';
        };

        // ========================================================================
        // UI Elements & Styling
        // ========================================================================

        const style = document.createElement('style');
        style.textContent = `
    #resultWindow, #resultWindow * { box-sizing: border-box; }
    #resultWindow {
        all: initial;
        box-sizing: border-box;
        position: fixed;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        width: 650px;
        min-height: auto;
        border-radius: 12px; font-family: ${STYLES.fonts.default};
        animation: slideUp 0.5s ease-out;
        opacity: 1;
        transition: opacity 0.3s ease;
        display: none;
        text-align: center;
        color: #FFFFFF;
        line-height: 1.4;
        background: linear-gradient(to bottom, #2A2D40, #1e1f2b);
        overflow: hidden;
        margin: 0;
        padding: 0;
        border: 0;
        z-index: 2147483647 !important;
    }
    #resultWindow.gc-hidden {
        opacity: 0;
        pointer-events: none;
    }
    #resultWindow-top {
        padding: 5px 5px 5px 5px !important;
        border-top-left-radius: 12px;
        border-top-right-radius: 12px;
        position: relative;
        z-index: 2 !important;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3) !important;
        color: #27293a !important;
    }
    #resultWindow-orientation {
        padding: 12px 5px 0px 5px !important;
        font-size: 0.9em;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
        position: relative;
        z-index: 1;
    }
    #resultWindow-info{
        padding: 0px 5px 0px 5px !important;
        font-size: 0.9em;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
        position: relative;
        z-index: 1;
   }
   #resultWindow-coupon {
        padding: 0px 5px 10px 5px !important;
        font-size: 0.9em;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
        position: relative;
        z-index: 1;
        text-align: center;
    }
    #resultWindow-coupon .code-separator {
        margin-left: 8px;
        margin-right: 8px;
        opacity: 0.8;
    }
   #resultWindow.eneba-checkout-highlight #resultWindow-coupon {
       background-color: linear-gradient(to bottom, #2A2D40, #1e1f2b);
       margin: 10px;
       padding: 0px 5px 10px 5px !important;
       border-radius: 8px;
       border-top-left-radius: 12px !important;
       border-top-right-radius: 12px !important;
       border-bottom-left-radius: 12px !important;
       border-bottom-right-radius: 12px !important;
   }
   #resultWindow .checkout-coupon-reminder {
       margin: 10px;
       padding: 0px 5px 10px 5px !important;
       font-weight: bold;
       font-size: 2em;
       color: #FFC107;
       text-align: center;

       margin-bottom: 5px;
       text-shadow: 0 0 3px #FFC107;

    }
    #resultWindow > div[id^="resultWindow-"],
    #resultWindow > .result-separator {
        box-sizing: border-box;
        font-family: inherit;
        color: inherit;
        line-height: inherit;
        text-align: inherit;
        display: block;
        margin: 0;
        padding: 0;
        border: 0;
        background-color: transparent;
        position: relative;
        z-index: 1;
    }
    #resultWindow .result-separator {
        height: 2px;
        border: none;
        border-top: 1px solid #242635;
        border-bottom: 1px solid #303040;
        margin: 10px 20px 10px 20px;
        padding: 0;
        box-sizing: border-box;
    }
    #resultWindow span,
    #resultWindow p,
    #resultWindow b,
    #resultWindow u,
    #resultWindow em {
        display: inline;
        font-family: inherit;
        color: inherit;
        line-height: inherit;
        text-align: inherit;
        font-size: inherit;
        margin: 0;
        padding: 0;
        border: 0;
        vertical-align: baseline;
        font-weight: normal;
        font-style: normal;
        text-decoration: none;
    }
    #resultWindow p {
        display: block;
        margin-bottom: 0.5em;
    }
    #resultWindow
        p:last-child
    {
        margin-bottom: 0;
    }
    #resultWindow b {
        font-weight: bold;
    }
    #resultWindow u {
        text-decoration: underline;
    }
    #resultWindow em {
        font-style: italic;
    }
    #resultWindow .price-category {
        font-size: 3.5em !important;
        font-weight: bold;
        display: block;
        margin-bottom: 5px;
        text-shadow: 2px 2px 3px #42444a;
    }
    #resultWindow .faktor-text {
        font-size: 1.2em;
        display: block;
        margin-bottom: 5px;
        font-weight: bold;
    }
    #resultWindow .orientation-title,
    #resultWindow .hinweise-title {
        font-weight: bold;
        font-size: 1.1em;
        display: block;
        color: #e0e0e0
        margin-bottom: 8px;
    }
    #resultWindow .orientation-details,
    #resultWindow .hinweise-details {
        display: block;
        color: #cccccc
    }
    #resultWindow .orientation-details b {
        color: #ffffff;
        font-weight: bold;
    }
    #resultWindow .info-hinweis {
        display: block;
        margin-bottom: 8px;
    }
    #resultWindow .info-hinweis b {
        font-weight: bold;
    }
    #resultWindow .discount-code {
        font-family: monospace;
        cursor: pointer;
        padding: 0 2px;
        background-color: #555555;
        border-radius: 3px;
        color: inherit;
        font-size: 1.7em;
        font-weight: bold;
        vertical-align: middle;
    }
    #resultWindow .fehler-message {
        margin-top: 5px;
        font-weight: bold;
        font-size: 1.5em;
        display: block;
    }
    #resultWindow .voucher-hint {
        display: block;
        font-size: 0.85em;
        color: #b0b0b0;
        margin-top: 8px;
        padding: 0 10px;
    }
    #resultWindow .voucher-hint a {
        color: #87ceeb;
        text-decoration: underline;
    }
     #resultWindow .voucher-hint a:hover {
        color: #aaddff;
    }
    .gc-toggle-switch {
        position: fixed;
        bottom: 10px;
        right: calc(50% - 325px);
        left: auto;
        transform: none;
        width: 72px;
        height: 36px;
        background-color: #ccc;
        border-radius: 18px;
        cursor: pointer;
        display: none;
        transition: background-color 1s ease, right 0.5s ease;
        z-index: 2147483647 !important;
        font-family: 'Roboto', sans-serif;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
    }
    .gc-toggle-switch .handle {
        box-sizing: border-box;
        position: absolute;
        top: 3px;
        left: 3px;
        right: auto;
        width: 30px;
        height: 30px;
        background-color: white;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        transition: transform 1s ease;
    }
    .gc-toggle-switch.on {
        background-color: #27293a;
    }
    .gc-toggle-switch.on .handle {
        transform: translateX(36px);
    }
    .gc-toggle-switch::before {
        content: "ON";
        position: absolute;
        top: 50%;
        left: 11px;
        transform: translateY(-50%);
        font-size: 0.9em;
        font-weight: bold;
        color: rgba(255, 255, 255, 0.8);
        line-height: 1;
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    .gc-toggle-switch.on::before {
        opacity: 1;
    }
    .gc-toggle-switch::after {
        content: "OFF";
        position: absolute;
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        font-size: 0.9em;
        font-weight: bold;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1;
        opacity: 0;
        transition: opacity 0.3s ease 0.1s;
    }
    .gc-toggle-switch.off::after {
        opacity: 1;
    }
    .gc-toggle-switch.off {
        background-color: #27293a;
        right: 10px;
    }
    .gc-toggle-switch.off .handle {
        transform: translateX(0);
    }
    .gc-toggle-switch.off::before {
        opacity: 0;
    }
      @media (max-width: 767px) {
    #resultWindow {
        width: auto;
        left: 10px;
        right: 10px;
        transform: none;
     }
     .gc-toggle-switch {
        right: 10px;
        transform: none;
           }
        }
   `;
        document.head.appendChild(style);

        const resultWindow = document.createElement('div');
        resultWindow.id = 'resultWindow';

        const toggleSwitch = document.createElement('div');
        toggleSwitch.className = 'gc-toggle-switch on';

        const handle = document.createElement('span');
        handle.className = 'handle';
        toggleSwitch.appendChild(handle);
        toggleSwitch.addEventListener('click', () => {
            const fadeDuration = 100;
            if (toggleSwitch.classList.contains('on')) {
                userClosedWindow = true;
                resultWindow.classList.add('gc-hidden');

                setTimeout(() => {
                    resultWindow.style.display = 'none';
                    toggleSwitch.classList.remove('on');
                    toggleSwitch.classList.add('off');

                }, fadeDuration);
            } else {
                userClosedWindow = false;
                toggleSwitch.classList.remove('off');
                toggleSwitch.classList.add('on');
                resultWindow.style.display = 'block';
                requestAnimationFrame(() => {
                    resultWindow.classList.remove('gc-hidden');
                });
            }
        });

        document.body.appendChild(resultWindow);
        document.body.appendChild(toggleSwitch);

        resultWindow.addEventListener('click', (event) => {
            const codeSpan = event.target.closest('span.discount-code');
            if (codeSpan) {
                let codeToCopy = null;

                // Neue, viel einfachere Logik
                switch (currentSite) {
                    case 'eneba.com':
                        codeToCopy = voucherCodes.Eneba;
                        break;
                    case 'kinguin.net':
                        codeToCopy = voucherCodes.Kinguin;
                        break;
                    case 'gamivo.com':
                        codeToCopy = voucherCodes.Gamivo;
                        break;
                    case 'driffle.com':
                        codeToCopy = voucherCodes.Driffle;
                        break;
                }

                const placeholders = ['Lade...', 'Fehler', 'Nicht verfügbar', 'Nicht gefunden', 'N/A'];
                if (codeToCopy && !placeholders.some(p => codeToCopy.includes(p))) {
                    navigator.clipboard.writeText(codeToCopy).then(() => {
                        const originalText = codeSpan.textContent;
                        document.querySelectorAll('#resultWindow .discount-code').forEach(span => {
                            if (span === codeSpan) {
                                span.textContent = 'Kopiert!';
                                span.style.backgroundColor = 'rgba(40, 167, 69, 0.4)';
                                span.style.cursor = 'default';
                            }
                        });

                        setTimeout(() => {
                            document.querySelectorAll('#resultWindow .discount-code').forEach(span => {
                                if (span === codeSpan && span.textContent === 'Kopiert!') {
                                    span.textContent = originalText;
                                    span.style.backgroundColor = '';
                                    span.style.cursor = 'pointer';
                                } else {
                                    span.style.backgroundColor = '';
                                    span.style.cursor = 'pointer';
                                }
                            });
                        }, 1500);
                    }).catch(err => {
                        const originalText = codeSpan.textContent;
                        codeSpan.textContent = 'Fehler!';
                        codeSpan.style.backgroundColor = 'rgba(220, 53, 69, 0.4)';
                        codeSpan.style.cursor = 'default';
                        setTimeout(() => {
                            if (codeSpan.textContent === 'Fehler!') {
                                codeSpan.textContent = originalText;
                                codeSpan.style.backgroundColor = '';
                                codeSpan.style.cursor = 'pointer';
                            }
                        }, 2000);
                    });
                }
            }
        });

        // ========================================================================
        // Helper Functions
        // ========================================================================

        const kinguinRemover = () => {
            if (currentSite !== 'kinguin.net') return;
            const headings = document.querySelectorAll('h2');

            for (const h2 of headings) {
                if (h2.textContent?.trim() === "Für dich empfohlen") {

                    const container = h2.parentElement?.parentElement?.parentElement;
                    if (container) {
                        container.remove();
                        break;
                    }
                }
            }
        };

        if (currentSite === 'kinguin.net') {
            const observeKinguinChanges = (mutationsList, observer) => {
                kinguinRemover();
            };

            const kinguinPageObserver = new MutationObserver(observeKinguinChanges);
            const startObserverWhenReady = () => {
                if (document.body) {
                    kinguinPageObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    kinguinRemover();
                } else {
                    setTimeout(startObserverWhenReady, 100);
                }
            };
            startObserverWhenReady();
        }

        const getProductCount = (selectedProducts) => {
            let count = 0;
            try {
                if (currentSite === 'gamivo.com') {
                    const isPaymentPage = window.location.pathname.includes('/payments');
                    if (isPaymentPage) {
                        const storedQuantity = sessionStorage.getItem('guthabenChecker_gamivoQuantity');
                        const quantity = parseInt(storedQuantity, 10);
                        if (!isNaN(quantity) && quantity > 0) {
                            return quantity;
                        } else {
                            return 1;
                        }
                    } else {
                        if (selectedProducts && selectedProducts.length > 0 && selectedProducts[0].tagName === 'INPUT') {
                            count = parseInt(selectedProducts[0].value, 10) || 0;
                        } else {
                            count = 0;
                        }
                        return count > 0 ? count : 0;
                    }
                } else if (currentSite === 'eneba.com') {
                    count = Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.innerText, 10) || 0), 0);
                } else if (currentSite === 'kinguin.net') {
                    count = Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.value, 10) || 0), 0);
                } else if (currentSite === 'driffle.com') {
                    count = Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.innerText || el.value || '0', 10)), 0);
                }
                else {
                    count = Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.value || el.innerText, 10) || 0), 0);
                }
            } catch (e) {
                return (currentSite === 'gamivo.com' && window.location.pathname.includes('/payments')) ? 1 : 0;
            }
            return count >= 0 ? count : ((currentSite === 'gamivo.com' && window.location.pathname.includes('/payments')) ? 1 : 0);
        };

        const checkMultipleProducts = () => {
            const isEnebaCheckoutPage = currentSite === 'eneba.com' && (window.location.pathname === '/checkout' || window.location.pathname === '/de/checkout');
            const isGamivoPaymentPage = currentSite === 'gamivo.com' && window.location.pathname.includes('/payments');
            const productItemsSelectors = {
                'eneba.com': 'li:has(button + span + button)',
                'kinguin.net': 'div[data-test="itemsWrapper"] > div:has(input[data-test="quantityInput"])',
                'gamivo.com': isGamivoPaymentPage ? '.payment-order-items__item' : '.cart-basket-items__box',
                'driffle.com': 'a[target="_blank"][href*="-p"]'
            };

            const selector = productItemsSelectors[currentSite];
            if (!selector) {
                return false;
            }

            const items = document.querySelectorAll(selector);
            if (items.length <= 1) {
                return false;
            }

            try {
                if (currentSite === 'driffle.com') {

                    const hrefs = [...items]
                    .map(link => link.getAttribute('href')?.trim())
                    .filter(href => href);

                    if (hrefs.length <= 1) return false;

                    const uniqueHrefs = new Set(hrefs);

                    if (uniqueHrefs.size > 1) {
                        if (!isEnebaCheckoutPage) {
                            displayError('Mehrere verschiedene Produkte im Warenkorb erkannt.<br>Berechnung nicht möglich.');
                            return true;
                        } else {

                            return false;
                        }
                    } else {
                        return false;
                    }

                } else {
                    const text1 = items[0]?.innerText?.trim() || "";
                    const text2 = items[1]?.innerText?.trim() || "";

                    if (text1 && text2 && text1 !== text2) {

                        if (!isEnebaCheckoutPage) {
                            displayError('Mehrere verschiedene Produkte im Warenkorb erkannt.<br>Berechnung nicht möglich.');
                            return true;
                        } else {

                            return false;
                        }

                    } else {
                        return false;
                    }
                }
            } catch(e) {
                return false;
            }
            return false;
        };

        const statesAreEqual = (state1, state2) => {
            if (!state1 || !state2) return false;


            if (state1.product !== state2.product ||
                state1.productCount !== state2.productCount ||
                state1.paymentMethod !== state2.paymentMethod) {
                return false;
            }

            if (currentSite === 'eneba.com' && state1.discountCodeEneba !== state2.discountCodeEneba) return false;
            if (currentSite === 'kinguin.net' && state1.discountCodeKinguin !== state2.discountCodeKinguin) return false;
            if (currentSite === 'driffle.com' && state1.discountCodeDriffle !== state2.discountCodeDriffle) return false;


            return true;
        };

        const isRelevantProduct = () => {
            const pageText = document.body.innerText;
            return Object.values(products).some(product =>
                                                CATEGORIES.some(category =>
                                                                product.text(category).some(targetText => pageText.includes(targetText))
                                                               )
                                               );
        };

        const findMatchingProduct = () => {
            const pageText = document.body.innerText;
            return Object.values(products).find(product =>
                                                CATEGORIES.some(category =>
                                                                product.text(category).some(targetText => pageText.includes(targetText))
                                                               )
                                               );
        };

        const getCrystalColor = (priceCategory) => {
            const gradients = {
                'Top': 'linear-gradient(to bottom, rgba(90, 180, 130, 0.85), rgba(120, 200, 160, 0.9))',
                'Gut': 'linear-gradient(to bottom, rgba(100, 150, 190, 0.85), rgba(130, 180, 210, 0.9))',
                'Okay': 'linear-gradient(to bottom, rgba(220, 140, 90, 0.85), rgba(240, 160, 110, 0.9))',
                'Schlecht': 'linear-gradient(to bottom, rgba(200, 80, 90, 0.85), rgba(220, 100, 110, 0.9))',
                'default': 'linear-gradient(to bottom, rgba(140, 140, 140, 0.8), rgba(160, 160, 160, 0.85))'
            };
            return gradients[priceCategory] || gradients.default;
        };

        // ========================================================================
        // Core Logic
        // ========================================================================

        const processLogic = () => {
            if (checkMultipleProducts()) {
                return;
            }

            const { selectedProducts, paymentMethodClassElement } = config.getElements();
            const product = findMatchingProduct();
            const isEnebaCheckoutPage = currentSite === 'eneba.com' && (window.location.pathname === '/checkout' || window.location.pathname === '/de/checkout');
            const isEnebaPaymentPage = currentSite === 'eneba.com' && window.location.href.includes('/checkout/payment');
            let paymentMethod;
            let productCount;

            if (!product) {
                if (isEnebaCheckoutPage) {
                    if (resultWindow.style.display !== 'none') resultWindow.style.display = 'none';
                    if (toggleSwitch.style.display !== 'none') toggleSwitch.style.display = 'none';
                    previousState = null; userClosedWindow = false;
                    return;
                } else {

                    if (paymentMethodClassElement) {
                        displayError('Produkt nicht erkannt!<br>Berechnung nicht möglich.');
                        return;
                    } else {
                        if (resultWindow.style.display !== 'none') resultWindow.style.display = 'none';
                        if (toggleSwitch.style.display !== 'none') toggleSwitch.style.display = 'none';
                        previousState = null;
                        return;
                    }
                }

                if (paymentMethodClassElement) {
                    displayError('Produkt nicht erkannt!<br>Berechnung nicht möglich.');
                    if (resultWindow.style.display === 'none' && !userClosedWindow) {
                        resultWindow.style.display = 'block';
                    }
                } else {

                    if (resultWindow.style.display !== 'none') {
                        resultWindow.style.display = 'none';
                    }
                    previousState = null;
                }
                return;
            }

            if (!paymentMethodClassElement) {
                if (!isEnebaCheckoutPage) {
                    if (resultWindow.style.display !== 'none') {
                        resultWindow.style.display = 'none';
                    }
                    previousState = null;
                    return;
                }

                if (!product) {
                    if (resultWindow.style.display !== 'none') {
                        resultWindow.style.display = 'none';
                    }
                    previousState = null;
                    return;
                }
                paymentMethod = 0;
                productCount = 0;
            } else {
                const paymentMethodText = paymentMethodClassElement.innerText;
                paymentMethod = parseFloat(paymentMethodText.replace(/[^\d.,]/g, '').replace(',', '.').trim());
                if (isNaN(paymentMethod)) {

                    if (!isEnebaCheckoutPage) {
                        previousState = null;

                        return;
                    } else {
                        paymentMethod = 0;
                    }
                }

                productCount = getProductCount(selectedProducts);

                if (productCount <= 0) {
                    if (!isEnebaCheckoutPage) {
                        if (resultWindow.style.display !== 'none') {
                            resultWindow.style.display = 'none';
                        }
                        previousState = null;
                        return;
                    } else {
                        productCount = 0;
                    }
                }
            }

            const currentState = {
                product: product.name,
                productCount,
                paymentMethod,
            };

            const getSiteSpecificText = () => {
                let baseTextHtml = "";
                let couponTextHtml = "";

                const formatCodeSpan = (code) => {
                    const placeholders = ['Lade...', 'Fehler', 'Nicht gefunden', 'N/A'];
                    const isPlaceholder = !code || placeholders.some(p => code.includes(p));
                    if (isPlaceholder) {
                        return `<span style="opacity: 0.7;">${code || 'N/A'}</span>`;
                    }
                    return `<span class="discount-code">${code}</span>`;
                };

                switch (currentSite) {
                    case 'gamivo.com':
                        baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Um Gebühren zu sparen, deaktiviere das Kundenschutzprogramm und SMART.<br>PayPal ist die günstigste Zahlungsmethode</span>`;
                        couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${formatCodeSpan(voucherCodes.Gamivo)}`;
                        break;

                    case 'eneba.com':
                        baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Google Pay und Apple Pay sind die günstigsten Zahlungsmethoden<br>Gutscheincodes können nicht mit dem EnebaWallet verwendet werden.</span>`;
                        couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${formatCodeSpan(voucherCodes.Eneba)}`;
                        break;

                    case 'kinguin.net':
                        baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Klarna oder SEPA sind die günstigsten Zahlungsmethoden<br>Wähle beim Besteuerungsort immer ‚Outside the EU and AU‘</span>`;
                        couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${formatCodeSpan(voucherCodes.Kinguin)}`;
                        break;

                    case 'driffle.com':
                        baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Google Pay, Apple Pay oder Kredit-/Debitkarte sind die günstigsten Zahlungsmethoden</span>`;
                        couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${formatCodeSpan(voucherCodes.Driffle)}`;
                        break;
                }
                return {
                    infoHtml: baseTextHtml ? `<em>${baseTextHtml}</em>` : "",
                    couponHtml: couponTextHtml ? `${couponTextHtml}` : ""
                };
            };

            if (!statesAreEqual(previousState, currentState)) {
                userClosedWindow = false;

                CATEGORIES.forEach(category => {
                    if (product.text(category).some(targetText => document.body.innerText.includes(targetText))) {
                        let factor, priceCategory, orientationText;
                        const numericCategory = parseFloat(category);

                        if (product.currency === "TRY") {
                            factor = (paymentMethod / (numericCategory * productCount * tryDayPrice)).toFixed(4);
                            priceCategory = determinePriceCategoryTRY(factor, product.thresholds);
                            orientationText = getOrientationTextTRY(category, productCount, product);
                        } else {
                            factor = (paymentMethod / (numericCategory * productCount)).toFixed(4);
                            priceCategory = determinePriceCategoryEUR(factor, product.thresholds);
                            orientationText = getOrientationTextEUR(category, productCount, product);
                        }

                        const siteContent = getSiteSpecificText();
                        const formattedPaymentMethod = formatPriceForDisplay(paymentMethod);
                        const nominalValuePerUnit = parseFloat(category);
                        const totalNominalValue = nominalValuePerUnit * productCount;
                        const currencySuffix = product.currency === 'TRY' ? ' TRY' : '€';
                        const formattedTotalNumber = totalNominalValue.toLocaleString(
                            product.currency === 'TRY' ? 'tr-TR' : 'de-DE',
                            { minimumFractionDigits: 0, maximumFractionDigits: 0 }
                        );
                        const formattedTotalNominalValue = formattedTotalNumber + currencySuffix;
                        const formattedPerUnitNumber = nominalValuePerUnit.toLocaleString(
                            product.currency === 'TRY' ? 'tr-TR' : 'de-DE',
                            { minimumFractionDigits: 0, maximumFractionDigits: 0 }
                        );
                        const formattedPerUnitValue = formattedPerUnitNumber + currencySuffix;

                        let quantityTextPart = '';
                        if (productCount >= 2) {

                            quantityTextPart = `(${productCount}x${formattedPerUnitValue}) `;
                        }
                        const topContent = `<span class="price-category">${priceCategory}</span><p style="font-size: 1.2em;">
    <strong>${quantityTextPart} ${formattedTotalNominalValue} ${product.name} &nbsp;=</strong>
    <strong style="text-decoration: underline double black; margin-left: 0.3em; margin-right: 0.3em;">${formattedPaymentMethod}</strong>
    <strong>|&nbsp; Faktor &nbsp;=</strong>
    <strong style="text-decoration: underline double black; margin-left: 0.3em;">${factor}</strong>
</p>`;
                        const orientationContent = `<span class="orientation-title">zur Orientierung</span><span class="orientation-details">${orientationText}</span>`;
                        displayResult(topContent, orientationContent, siteContent.infoHtml, siteContent.couponHtml, priceCategory);
                    }
                });
                if (!isRelevantProduct()) {
                    resultWindow.style.display = 'none';
                }
                previousState = currentState;
            } else {
                if (!userClosedWindow && resultWindow.style.display === 'none' && isRelevantProduct() && paymentMethodClassElement && !isNaN(paymentMethod) && paymentMethod > 0) {
                    resultWindow.style.display = 'block';
                }
            }
        };

        // ========================================================================
        // Display Functions
        // ========================================================================

        const displayResult = (topContent, orientationContent, infoContent, couponContent, priceCategory) => {
            const isEnebaCheckoutPageCurrently = currentSite === 'eneba.com' && (window.location.pathname === '/checkout' || window.location.pathname === '/de/checkout');
            if (isEnebaCheckoutPageCurrently) {
                resultWindow.classList.add('eneba-checkout-highlight');
            } else {
                resultWindow.classList.remove('eneba-checkout-highlight');
            }
            if (!topContent && !orientationContent && !infoContent && !couponContent) {

                return;
            }
            const isEnebaCheckoutPage = currentSite === 'eneba.com' && (window.location.pathname === '/checkout' || window.location.pathname === '/de/checkout');
            if (!userClosedWindow) {
                const topBgGradient = getCrystalColor(priceCategory);

                let siteSpecificHintHtml = '';
                if (currentSite === 'kinguin.net' || currentSite === 'driffle.com' || currentSite === 'eneba.com') {
                    let hintLinkUrl = '';
                    if (currentSite === 'kinguin.net') {
                        hintLinkUrl = 'https://www.allkeyshop.com/redirection/offer/eur/135018899?locale=en&merchant=47';
                    } else if (currentSite === 'driffle.com') {
                        hintLinkUrl = 'https://www.allkeyshop.com/redirection/offer/eur/134960792?locale=en&merchant=408';
                    } else if (currentSite === 'eneba.com') {
                        hintLinkUrl = 'https://www.allkeyshop.com/redirection/offer/eur/132713968?locale=en&merchant=272';
                    }
                    if (hintLinkUrl) {
                        siteSpecificHintHtml = `
                        <p class="voucher-hint">
                            Gutscheincode funktioniert nicht? Dann lass dich
                            <a href="${hintLinkUrl}" target="_blank" rel="noopener noreferrer">hier</a>
                            weiterleiten und akzeptiere alle Cookies.
                        </p>
                    `;
                    }
                }
                let checkoutReminderHtml = '';
                if (isEnebaCheckoutPageCurrently) {
                    checkoutReminderHtml = `
            <div class="checkout-coupon-reminder">
                Denk an den Gutscheincode!
            </div>
            <div class="result-separator"></div>
        `;
                }
                resultWindow.innerHTML = `
                ${!isEnebaCheckoutPage ? `
                    <div id="resultWindow-top" style="background: ${topBgGradient};">
                        ${topContent || ""}
                    </div>
                    ${orientationContent ? `<div id="resultWindow-orientation">${orientationContent}</div><div class="result-separator"></div>` : ''}
                    ${infoContent ? `<div id="resultWindow-info">${infoContent}</div><div class="result-separator"></div>` : ''}
                ` : ''}
                ${checkoutReminderHtml}
                ${couponContent || siteSpecificHintHtml ?
                    `<div id="resultWindow-coupon">
                        ${couponContent || ""}
                        ${siteSpecificHintHtml}
                    </div>`
                    : ''
            }
            `;
                resultWindow.style.display = 'block';
                requestAnimationFrame(() => {
                    resultWindow.classList.remove('gc-hidden');
                });
                toggleSwitch.style.display = 'block';
                toggleSwitch.classList.add('on');
                toggleSwitch.classList.remove('off');
            }
        };

        const displayError = (message) => {
            const isEnebaCheckoutPage = currentSite === 'eneba.com' && (window.location.pathname === '/checkout' || window.location.pathname === '/de/checkout');
            if (isEnebaCheckoutPage) {

                return;
            }
            const errorBg = getCrystalColor('Schlecht');

            resultWindow.innerHTML = `
        <div id="resultWindow-top" style="background: ${errorBg}; border-radius: 12px; padding: 15px 10px;">
            <p class="fehler-message" style="color: #27293a;">${message}</p>
        </div>
    `;

            if (!userClosedWindow) {
                if (resultWindow.style.display === 'none') {
                    resultWindow.style.display = 'block';
                    requestAnimationFrame(() => { resultWindow.classList.remove('gc-hidden'); });
                }
                if (toggleSwitch.style.display === 'none') {
                    toggleSwitch.style.display = 'block';
                }

                if (!toggleSwitch.classList.contains('on')) {
                    toggleSwitch.classList.remove('off');
                    toggleSwitch.classList.add('on');
                }
            } else {
            }
        };

        // ========================================================================
        // UI Visibility Handler & Main Loop
        // ========================================================================

        const updateUIVisibility = () => {
            let isOnRelevantPage = false;
            const currentPath = window.location.pathname;
            const currentHref = window.location.href;
            const isGamivoPaymentPage = currentSite === 'gamivo.com' && currentPath.includes('/payments');

            if (isGamivoPaymentPage) {
                const accordionButton = document.querySelector('div[data-testid="cart-summary__orders--accordion-btn"]');
                const accordionToggle = accordionButton?.closest('.accordion-toggle');
                const detailsPanel = accordionToggle?.closest('.panel')?.querySelector('.panel-collapse');

                if (accordionButton && detailsPanel) {
                    const isExpanded = detailsPanel.offsetParent !== null;

                    if (!isExpanded) {
                        if (resultWindow.style.display !== 'none') resultWindow.style.display = 'none';
                        if (toggleSwitch.style.display !== 'none') toggleSwitch.style.display = 'none';
                        previousState = null;

                        if (!accordionButton.dataset.clickedRecently) {
                            accordionButton.click();
                            accordionButton.dataset.clickedRecently = 'true';
                            setTimeout(() => { delete accordionButton.dataset.clickedRecently; }, 1000);
                        } else {
                        }
                        return;
                    } else {
                        isOnRelevantPage = true;
                    }
                } else {
                    if (resultWindow.style.display !== 'none') resultWindow.style.display = 'none';
                    if (toggleSwitch.style.display !== 'none') toggleSwitch.style.display = 'none';
                    previousState = null;
                    return;
                }
            }

            if (!isGamivoPaymentPage) {
                if (currentSite === 'gamivo.com') {
                    isOnRelevantPage = currentPath.includes('/cart');
                } else if (config.paymentPageUrl) {
                    if (typeof config.paymentPageUrl === 'string' && config.paymentPageUrl.startsWith('/')) {
                        isOnRelevantPage = currentPath.endsWith(config.paymentPageUrl) || currentPath.endsWith(config.paymentPageUrl + '/');
                    } else if (typeof config.paymentPageUrl === 'string') {
                        isOnRelevantPage = currentHref.startsWith(config.paymentPageUrl);
                    }
                }
            }

            const isEnebaCheckoutPage = currentSite === 'eneba.com' && (currentPath === '/checkout' || currentPath === '/de/checkout');

            if (!isOnRelevantPage && !isEnebaCheckoutPage) {
                if (resultWindow.style.display !== 'none') {
                    resultWindow.style.display = 'none';
                }
                if (toggleSwitch.style.display !== 'none') {
                    toggleSwitch.style.display = 'none';
                }
                if (previousState !== null) {
                    previousState = null;
                }
                return;
            }

            let blockProcessing = false;
            if (currentSite === 'driffle.com') {
                const isMobileWidth = window.innerWidth <= 1023;
                if (isMobileWidth) {
                    const orderSummaryDrawerSelector = 'div.MuiDrawer-paperAnchorBottom.css-1rlwp30';
                    const orderSummaryDrawer = document.querySelector(orderSummaryDrawerSelector);
                    if (!orderSummaryDrawer) {
                        blockProcessing = true;
                        if (resultWindow.style.display !== 'none') resultWindow.style.display = 'none';
                        if (toggleSwitch.style.display !== 'none') toggleSwitch.style.display = 'none';
                        if (previousState !== null) previousState = null;
                    }
                }
            }
            if (blockProcessing) {
                return;
            }

            kinguinRemover();
            processLogic();

            if (!userClosedWindow) {
                if (resultWindow.style.display !== 'none') {
                    if (toggleSwitch.style.display === 'none') {
                        toggleSwitch.style.display = 'block';
                    }
                    if (!toggleSwitch.classList.contains('on')) {
                        toggleSwitch.classList.remove('off');
                        toggleSwitch.classList.add('on');
                    }
                } else {
                    if (toggleSwitch.style.display !== 'none') {
                        toggleSwitch.style.display = 'none';
                    }
                }
            } else {
                if (toggleSwitch.style.display === 'none') {
                    toggleSwitch.style.display = 'block';
                }
                if (!toggleSwitch.classList.contains('off')) {
                    toggleSwitch.classList.remove('on');
                    toggleSwitch.classList.add('off');
                }
            }
        };

        updateUIVisibility();
        setInterval(updateUIVisibility, 500);
    }
    main();

})();
