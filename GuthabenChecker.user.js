// ==UserScript==
// @name            Guthaben Checker (Beta)
// @namespace       http://tampermonkey.net/
// @version         2.0.3
// @description     Checkt Guthabenseiten
// @author          kenixa
// @match           https://www.eneba.com/*
// @match           https://www.kinguin.net/*
// @match           https://www.gamivo.com/*
// @match           https://driffle.com/*
// @updateURL       https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @downloadURL     https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @grant           GM_xmlhttpRequest
// @connect         gg.deals
// @connect         allkeyshop.com
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

    const products = {
        playstation: {
            name: "PlayStation Store",
            factors: [0.79999, 0.80999, 0.81999, 0.82],
            thresholds: [0.7999, 0.8099, 0.8199],
            currency: "EUR",
            text: (c) => [
                `PlayStation Network Card ${c} EUR (DE) PSN Key GERMANY`,
                `Playstation Network Card ${c} EUR (DE) PSN Key GERMANY`,
                `PSN Guthaben Karte ${c} EUR (DE) PSN key DEUTSCHLAND`,
                `PlayStation Network Card €${c} DE`,
                `PlayStation Network Card PSN EUR DE €${c}`,
                `PlayStation Store ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        nintendo: {
            name: "Nintendo eShop",
            factors: [0.80999, 0.82999, 0.85999, 0.86],
            thresholds: [0.8099, 0.8299, 0.8599],
            currency: "EUR",
            text: (c) => [
                `Nintendo eShop Card ${c} EUR Key GERMANY`,
                `Nintendo eShop Card ${c} EUR Key EUROPE`,
                `Nintendo eShop Prepaid Card €${c} EU Key`,
                `Nintendo eShop Prepaid Card €${c} DE Key`,
                `Nintendo eShop EUR DE €${c}`,
                `Nintendo eShop EUR €${c}`,
                `Nintendo eShop ${c} EUR Gift Card (Europe) - Digital Key`,
                `Nintendo eShop ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        airbnb: {
            name: "Airbnb",
            factors: [0.89999, 0.92500, 0.93699, 0.9370],
            thresholds: [0.8999, 0.9250, 0.9369],
            currency: "EUR",
            text: (c) => [
                `Airbnb ${c} EUR Gift Card Key GERMANY`,
                `Airbnb €${c} Gift Card DE`,
                `Airbnb Gift Card EUR DE €${c}`,
                `Airbnb ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        amazon: {
            name: "Amazon",
            factors: [0.89999, 0.92500, 0.93699, 0.9370],
            thresholds: [0.8999, 0.9250, 0.9369],
            currency: "EUR",
            text: (c) => [
                `Amazon Gift Card ${c} EUR Key GERMANY`,
                `Amazon €${c} Gift Card DE`,
                `Amazon Gift Card EUR DE €${c}`,
                `Amazon ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        blizzard: {
            name: "Battle.net Store",
            factors: [0.90000, 0.92000, 0.94000, 0.9401],
            thresholds: [0.9000, 0.9200, 0.9400],
            currency: "EUR",
            text: (c) => [
                `Battle.net Gift Card ${c} EUR Battle.net Key EUROPE`,
                `Blizzard €${c} EU Battle.net Gift Card`,
                `Blizzard Gift Card EUR DE €${c}`,
                `Blizzard Gift Card EUR EU €${c}`,
                `Blizzard ${c} EUR Gift Card (Europe) - Digital Key`
            ]
        },
        googleplay: {
            name: "Google Play Store",
            factors: [0.90000, 0.92000, 0.94000, 0.9401],
            thresholds: [0.9000, 0.9200, 0.9400],
            currency: "EUR",
            text: (c) => [
                `Google Play Gift Card ${c} EUR Key GERMANY`,
                `Google Play Gift Card ${c} EUR Key EUROPE`,
                `Google Play €${c} EU Gift Card`,
                `Google Play €${c} DE Gift Card`,
                `Google Play Gift Card EUR DE €${c}`,
                `Google Play Gift Card EUR EU €${c}`,
                `Google Play ${c} EUR Gift Card (Europe) - Digital Key`,
                `Google Play ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        ikea: {
            name: "Ikea",
            factors: [0.89999, 0.92500, 0.93699, 0.9370],
            thresholds: [0.8999, 0.9250, 0.9369],
            currency: "EUR",
            text: (c) => [
                `IKEA Gift Card ${c} EUR Key GERMANY`,
                `IKEA €${c} Gift Card DE`,
                `IKEA €${c} Gift Card EU`,
                `IKEA Gift Card EUR DE €${c}`,
                `IKEA ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        itunes: {
            name: "iTunes",
            factors: [0.90000, 0.92000, 0.94000, 0.9401],
            thresholds: [0.9000, 0.9200, 0.9400],
            currency: "EUR",
            text: (c) => [
                `Apple iTunes Gift Card ${c} EUR iTunes Key GERMANY`,
                `Apple Gift Card ${c} EUR Key GERMANY`,
                `iTunes €${c} DE Card`,
                `Apple €${c} Gift Card DE`,
                `iTunes Gift Card EUR DE €${c}`,
                `App Store & iTunes EUR DE €${c}`,
                `Apple iTunes ${c} EUR Gift Card (Germany) - Digital Key`,
                `Apple ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        lieferando: {
            name: "Lieferando",
            factors: [0.830000, 0.860000, 0.890000, 0.9201],
            thresholds: [0.8300, 0.8600, 0.8900],
            currency: "EUR",
            text: (c) => [
                `Lieferando.de Gift Card ${c} EUR Key GERMANY`,
                `Lieferando €${c} Voucher DE`,
                `Lieferando (Just Eat) ${c} EUR Gift Card (Germany) - Digital Key`,
                `Just Eat Gift Card EUR DE €${c}`
            ]
        },
        netflix: {
            name: "Netflix",
            factors: [0.820000, 0.840000, 0.860000, 0.8601],
            thresholds: [0.8200, 0.8400, 0.8600],
            currency: "EUR",
            text: (c) => [
                `Netflix Gift Card ${c} EUR Key GERMANY`,
                `Netflix Gift Card ${c} EUR Key EUROPE`,
                `Netflix Gift Card €${c} EU`,
                `Netflix €${c} Gift Card EU`,
                `Netflix EUR ${c} Gift Card EU`,
                `Netflix Gift Card EUR DE €${c}`,
                `Netflix Gift Card EUR EU €${c}`,
                `Netflix ${c} EUR Gift Card (Europe) - Digital Key`,
                `Netflix ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        steam: {
            name: "Steam",
            factors: [0.90000, 0.92000, 0.94001, 0.94002],
            thresholds: [0.9000, 0.9200, 0.9400],
            currency: "EUR",
            text: (c) => [
                `Steam Wallet Gift Card ${c} EUR Steam Key GERMANY`,
                `Steam Wallet Gift Card ${c} EUR Steam Key EUROPE`,
                `Steam Guthaben Karte ${c} EUR Steam Key EUROPE`,
                `Steam Guthaben Karte ${c} EUR Steam Key GERMANY`,
                `Steam Wallet Card €${c} EU Activation Code`,
                `Steam Wallet Card €${c} Global Activation Code`,
                `Steam Gift Card €${c} EU Activation Code`,
                `Steam Gift Card EUR DE €${c}`,
                `Steam Gift Card EUR EU €${c}`,
                `Steam Wallet ${c} EUR Gift Card (Europe) - Digital Key`
            ]
        },
        xbox: {
            name: "Xbox Store",
            factors: [0.85999, 0.87999, 0.90000, 0.9001],
            thresholds: [0.8599, 0.8799, 0.9000],
            currency: "EUR",
            text: (c) => [
                `Xbox Live Gift Card ${c} EUR Xbox Live Key GERMANY`,
                `Xbox Live Gift Card ${c} EUR Xbox Live Key EUROPE`,
                `Xbox Live Guthaben Karte ${c} EUR Xbox Live key EUROPE`,
                `XBOX Live €${c} Prepaid Card EU`,
                `XBOX Live €${c} Prepaid Card DE`,
                `Xbox Live Gift Card EUR EU €${c}`,
                `Xbox Live Gift Card EUR €${c}`,
                `Xbox Live Gift Card EUR DE €${c}`,
                `Xbox ${c} EUR Gift Card (Europe) - Digital Key`,
                `Xbox ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        zalando: {
            name: "Zalando",
            factors: [0.86000, 0.88000, 0.92000, 0.9201],
            thresholds: [0.86, 0.88, 0.92],
            currency: "EUR",
            text: (c) => [
                `Zalando Gift Card ${c} EUR Key GERMANY`,
                `Zalando ${c} EUR Gift Card DE`,
                `Zalando Gift Card EUR DE €${c}`,
                `Zalando Gift Card EUR EU €${c}`,
                `Zalando ${c} EUR Gift Card (Germany) - Digital Key`
            ]
        },
        itunesTRY: {
            name: "iTunes Türkei",
            factors: [0.9600, 1.0000, 1.0400, 1.0401],
            thresholds: [0.9600, 1.0000, 1.0400],
            currency: "TRY",
            text: (c) => [
                `Apple iTunes Gift Card ${c} TRY iTunes Key TURKEY`,
                `iTunes ₺${c} TR Card`,
                `Apple ${c} TRY Gift Card (Turkey) - Digital Key`,
                `iTunes Gift Card TRY TR ₺${c}`
            ]
        },
        netflixTRY: {
            name: "Netflix Türkei",
            factors: [1.02, 1.06, 1.10, 1.11],
            thresholds: [1.02, 1.06, 1.10],
            currency: "TRY",
            text: (c) => [
                `Netflix Gift Card ${c} TRY Key TURKEY`,
                `Netflix TRY ${c} Gift Card TR`,
                `Netflix ${c} TRY Gift Card (Turkey) - Digital Key`,
                `Netflix Gift Card TRY TR ₺${c}`
            ]
        },
    };
    const CATEGORIES = Array.from({ length: 2000 }, (_, i) => (i + 1).toString());

    // ========================================================================
    // GLOBAL STATE VARIABLES
    // ========================================================================

    let previousState = null;
    let userClosedWindow = false;
    let tryDayPrice = 0.024;
    let enebaDiscountCode = 'Lade...';
    let kinguinDiscountCode = 'Lade...';
    let driffleDiscountCode = 'Lade...';
    let kinguinDiscountCodeAKS = 'Lade...';
    let enebaDiscountCodeAKS = 'Lade...';

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

    const fetchEnebaDiscountCode = () => {
        const voucherUrl = 'https://gg.deals/vouchers/?applicableOn=everything&store=60';
        GM_xmlhttpRequest({
            method: "GET", url: voucherUrl,
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');
                    const codeElement = doc.querySelector('span.code.copy-clipboard-action[data-clipboard-text]');
                    if (codeElement) {
                        const code = codeElement.getAttribute('data-clipboard-text');
                        enebaDiscountCode = code ? code.trim() : 'Nicht gefunden (Attribut leer)';
                    } else {
                        enebaDiscountCode = 'Nicht gefunden';
                    }
                } else {
                    enebaDiscountCode = `Fehler ${response.status}`;
                }
            },
            onerror: function(error) {
                enebaDiscountCode = 'Fehler (Netzwerk)';
            }
        });
    };

    const fetchEnebaDiscountCodeAKS = () => {
        const voucherPageUrl = 'https://www.allkeyshop.com/blog/vouchers/eneba/';
        let currentCodeValue = 'Lade...';
        let foundCode = null;

        try {
            GM_xmlhttpRequest({
                method: "GET",
                url: voucherPageUrl,
                timeout: 15000,
                onload: function(response) {

                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(response.responseText, 'text/html');
                            const tableBody = doc.querySelector('tbody.v-voucherlist');

                            if (tableBody) {
                                const allEnebaRows = Array.from(tableBody.querySelectorAll('tr'))
                                .filter(row => row.querySelector('img[src*="images/merchants/eneba.png"]'));

                                if (allEnebaRows.length > 0) {
                                    let latestMatchingCode = null;

                                    for (const row of allEnebaRows) {
                                        const titleElement = row.querySelector('p.v-card-title');
                                        const titleText = titleElement?.textContent?.trim() || '';
                                        const copyClipElement = row.querySelector('aks-copyclip');
                                        const potentialCode = copyClipElement?.textContent?.trim();


                                        if (/\b5%/.test(titleText) || titleText.startsWith('5%')) {

                                            if (copyClipElement && potentialCode) {

                                                latestMatchingCode = potentialCode;
                                            }
                                        }
                                    }

                                    if (latestMatchingCode) {
                                        foundCode = latestMatchingCode;
                                        currentCodeValue = foundCode;
                                    } else {
                                        currentCodeValue = 'Nicht gefunden (Kein 5% Code)';
                                    }

                                } else { currentCodeValue = 'Nicht gefunden (Keine Eneba Zeile)'; }
                            } else { currentCodeValue = 'Nicht gefunden (tbody)'; }
                        } catch (parseError) { console.error('[Eneba AKS] Fehler beim Parsen:', parseError); currentCodeValue = 'Fehler (Parse)'; }
                    } else { currentCodeValue = `Fehler ${response.status}`; }

                    if (enebaDiscountCodeAKS !== currentCodeValue) {
                        enebaDiscountCodeAKS = currentCodeValue;

                    }

                },
                onerror: function(response) {
                    const errorMsg = 'Fehler (Netzwerk)';
                    if (enebaDiscountCodeAKS !== errorMsg) enebaDiscountCodeAKS = errorMsg;
                },
                ontimeout: function() {
                    const errorMsg = 'Fehler (Timeout)';
                    if (enebaDiscountCodeAKS !== errorMsg) enebaDiscountCodeAKS = errorMsg;
                }
            });
        } catch (e) {
            enebaDiscountCodeAKS = 'Fehler (Skript)';
        }
    };

    const fetchKinguinDiscountCode = () => {
        const voucherUrl = 'https://gg.deals/vouchers/?store=1';
        GM_xmlhttpRequest({
            method: "GET", url: voucherUrl,
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');
                    const kinguinVoucherItems = Array.from(doc.querySelectorAll('div.voucher-item'))
                    .filter(item => item.querySelector('img[alt="Kinguin"]'));

                    if (kinguinVoucherItems.length === 0) {
                        kinguinDiscountCode = 'Nicht gefunden (Kein Kinguin Item)';
                        return;
                    }

                    let foundCode = null; const targetTitleIdentifier = "8%";
                    for (const item of kinguinVoucherItems) {
                        const titleElement = item.querySelector('.info-title .title');
                        const codeElement = item.querySelector('.voucher-code span.code.copy-clipboard-action[data-clipboard-text]');
                        if (titleElement && codeElement && titleElement.textContent.includes(targetTitleIdentifier)) {
                            const code = codeElement.getAttribute('data-clipboard-text');
                            if (code) { foundCode = code.trim(); break; }
                        }
                    }

                    if (!foundCode && kinguinVoucherItems.length > 0) {
                        const firstItemCodeElement = kinguinVoucherItems[0].querySelector('.voucher-code span.code.copy-clipboard-action[data-clipboard-text]');
                        if (firstItemCodeElement) {
                            const fallbackCode = firstItemCodeElement.getAttribute('data-clipboard-text');
                            if (fallbackCode) {
                                foundCode = fallbackCode.trim();
                            }
                        }
                    }

                    if (foundCode) {
                        kinguinDiscountCode = foundCode;
                    } else {
                        kinguinDiscountCode = 'Nicht gefunden (Kein Code Element)';
                    }
                } else {
                    kinguinDiscountCode = `Fehler ${response.status}`;
                }
            },
            onerror: function(error) {
                kinguinDiscountCode = 'Fehler (Netzwerk)';
            }
        });
    };

    const fetchKinguinDiscountCodeAKS = () => {
        const voucherPageUrl = 'https://www.allkeyshop.com/blog/vouchers/kinguin/';
        let currentCodeValue = 'Lade...';
        let foundCode = null;

        try {
            GM_xmlhttpRequest({
                method: "GET",
                url: voucherPageUrl,
                timeout: 15000,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(response.responseText, 'text/html');
                            const tableBody = doc.querySelector('tbody.v-voucherlist');

                            if (tableBody) {
                                const allKinguinRows = Array.from(tableBody.querySelectorAll('tr'))
                                .filter(row => row.querySelector('img[src*="images/merchants/kinguin.png"]'));

                                if (allKinguinRows.length > 0) {
                                    let latestMatchingCode = null;

                                    for (const row of allKinguinRows) {
                                        const titleElement = row.querySelector('p.v-card-title');
                                        const titleText = titleElement?.textContent?.trim() || '';
                                        const copyClipElement = row.querySelector('aks-copyclip');
                                        const potentialCode = copyClipElement?.textContent?.trim();

                                        if (/\b8%/.test(titleText) || titleText.startsWith('8%')) {
                                            if (copyClipElement && potentialCode) {
                                                latestMatchingCode = potentialCode;

                                            } else {
                                            }
                                        }
                                    }

                                    if (latestMatchingCode) {
                                        foundCode = latestMatchingCode;
                                        currentCodeValue = foundCode;
                                    } else {
                                        currentCodeValue = 'Nicht gefunden (Kein 8% Code)';
                                    }

                                } else { currentCodeValue = 'Nicht gefunden (Keine Kinguin Zeile)'; }
                            } else { currentCodeValue = 'Nicht gefunden (tbody)'; }
                        } catch (parseError) { console.error('[Kinguin AKS] Fehler beim Parsen (V1.1):', parseError); currentCodeValue = 'Fehler (Parse)'; }
                    } else { currentCodeValue = `Fehler ${response.status}`; }

                    if (kinguinDiscountCodeAKS !== currentCodeValue) { kinguinDiscountCodeAKS = currentCodeValue; }
                },
                onerror: function(response) {
                    const errorMsg = 'Fehler (Netzwerk)'; if (kinguinDiscountCodeAKS !== errorMsg) kinguinDiscountCodeAKS = errorMsg;
                },
                ontimeout: function() {
                    const errorMsg = 'Fehler (Timeout)'; if (kinguinDiscountCodeAKS !== errorMsg) kinguinDiscountCodeAKS = errorMsg;
                }
            });
        } catch (e) { kinguinDiscountCodeAKS = 'Fehler (Skript)'; }
    };

    const fetchDriffleDiscountCode = () => {
        const voucherPageUrl = 'https://www.allkeyshop.com/blog/vouchers/driffle/';
        let currentCodeValue = 'Lade...';

        try {
            GM_xmlhttpRequest({
                method: "GET",
                url: voucherPageUrl,
                timeout: 15000,
                onload: function(response) {
                    let code = null;
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(response.responseText, 'text/html');
                            const tableBody = doc.querySelector('tbody.v-voucherlist');

                            if (tableBody) {
                                const allDriffleRows = Array.from(tableBody.querySelectorAll('tr'))
                                .filter(row => row.querySelector('img[src*="images/merchants/driffle.png"]'));

                                if (allDriffleRows.length > 0) {
                                    const lastRow = allDriffleRows[allDriffleRows.length - 1];
                                    const copyClipElement = lastRow.querySelector('aks-copyclip');
                                    if (copyClipElement) {
                                        const rawText = copyClipElement.textContent;
                                        if (rawText) {
                                            code = rawText.trim();
                                        }
                                        currentCodeValue = code ? code : 'Nicht gefunden';
                                    } else { currentCodeValue = 'Nicht gefunden'; }
                                } else { currentCodeValue = 'Nicht gefunden'; }
                            } else { currentCodeValue = 'Nicht gefunden'; }
                        } catch (parseError) {
                            currentCodeValue = 'Fehler (Parse)';
                        }
                    } else {
                        currentCodeValue = `Fehler ${response.status}`;
                    }
                    if (driffleDiscountCode !== currentCodeValue) {
                        driffleDiscountCode = currentCodeValue;
                    }
                },
                onerror: function(response) {
                    const errorMsg = 'Fehler (Netzwerk)';
                    if (driffleDiscountCode !== errorMsg) driffleDiscountCode = errorMsg;
                },
                ontimeout: function() {
                    const errorMsg = 'Fehler (Timeout)';
                    if (driffleDiscountCode !== errorMsg) driffleDiscountCode = errorMsg;
                }
            });
        } catch (e) {
            driffleDiscountCode = 'Fehler (Skript)';
        }
    };

    fetchExchangeRate();
    fetchEnebaDiscountCode();
    fetchEnebaDiscountCodeAKS();
    fetchKinguinDiscountCode();
    fetchDriffleDiscountCode();
    fetchKinguinDiscountCodeAKS();

    setInterval(fetchExchangeRate, 30 * 60 * 1000);
    setInterval(fetchEnebaDiscountCode, 15 * 60 * 1000);
    setInterval(fetchKinguinDiscountCode, 15 * 60 * 1000);
    setInterval(fetchDriffleDiscountCode, 15 * 60 * 1000);
    setInterval(fetchKinguinDiscountCodeAKS, 15 * 60 * 1000);
    setInterval(fetchEnebaDiscountCodeAKS, 15 * 60 * 1000);

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
            const clickedCodeText = codeSpan.textContent.trim();

            if (currentSite === 'eneba.com') {
                if (clickedCodeText === enebaDiscountCode) {
                    codeToCopy = enebaDiscountCode;
                } else if (clickedCodeText === enebaDiscountCodeAKS) {
                    codeToCopy = enebaDiscountCodeAKS;
                } else {
                    codeToCopy = enebaDiscountCode;
                }
            } else if (currentSite === 'kinguin.net') {
                if (clickedCodeText === kinguinDiscountCode) {
                    codeToCopy = kinguinDiscountCode;
                } else if (clickedCodeText === kinguinDiscountCodeAKS) {
                    codeToCopy = kinguinDiscountCodeAKS;
                } else {
                    codeToCopy = kinguinDiscountCode;
                }
            } else if (currentSite === 'gamivo.com') {
                codeToCopy = "PRPX";
            } else if (currentSite === 'driffle.com') {
                codeToCopy = driffleDiscountCode;
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
                        } else {

                        }
                    });

                    setTimeout(() => {

                        document.querySelectorAll('#resultWindow .discount-code').forEach(span => {

                            if (span === codeSpan && span.textContent === 'Kopiert!') {
                                span.textContent = originalText;
                                span.style.backgroundColor = '';
                                span.style.cursor = 'pointer';
                            }
                            else {
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
            } else {
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
            discountCodeEneba: enebaDiscountCode,
            discountCodeKinguin: kinguinDiscountCode,
            discountCodeDriffle: driffleDiscountCode,
        };

        const getSiteSpecificText = () => {
            let baseTextHtml = "";
            let couponTextHtml = "";

            const formatCodeSpan = (code, isValid = true) => {
                const placeholders = ['Lade...', 'Fehler', 'Nicht gefunden', 'N/A'];
                const isPlaceholder = !code || placeholders.some(p => code.includes(p));
                if (!isValid || isPlaceholder) {
                    return `<span style="opacity: 0.7;">${code || 'N/A'}</span>`;
                }
                return `<span class="discount-code">${code}</span>`;
            };

            const isValidCode = (code) => {
                const placeholders = ['Lade...', 'Fehler', 'Nicht gefunden', 'N/A'];
                return code && !placeholders.some(p => code.includes(p));
            };

            switch (currentSite) {
                case 'gamivo.com': {
                    baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Um Gebühren zu sparen, deaktiviere das Kundenschutzprogramm und SMART.<br>PayPal ist die günstigste Zahlungsmethode</span>`;
                    const finalCode = "PRPX";
                    const codeDisplay = formatCodeSpan(finalCode);
                    couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${codeDisplay}`;
                    break;
                }
                case 'eneba.com': {
                    baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Google Pay und Apple Pay sind die günstigsten Zahlungsmethoden<br>Gutscheincodes können nicht mit dem EnebaWallet verwendet werden.</span>`;

                    const codeGG = enebaDiscountCode;
                    const codeAKS = enebaDiscountCodeAKS;
                    const validGG = isValidCode(codeGG);
                    const validAKS = isValidCode(codeAKS);
                    let combinedCodeDisplay = '';

                    if (validGG && validAKS) {
                        if (codeGG.toLowerCase() === codeAKS.toLowerCase()) {
                            combinedCodeDisplay = formatCodeSpan(codeGG);
                        } else {
                            combinedCodeDisplay = `${formatCodeSpan(codeGG)}<span class="code-separator">oder</span>${formatCodeSpan(codeAKS)}`;
                        }
                    } else if (validGG) {
                        combinedCodeDisplay = formatCodeSpan(codeGG);
                    } else if (validAKS) {
                        combinedCodeDisplay = formatCodeSpan(codeAKS);
                    } else {
                        combinedCodeDisplay = formatCodeSpan(codeGG, false);
                    }

                    couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${combinedCodeDisplay}`;
                    break;
                }
                case 'kinguin.net': {
                    baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Klarna oder SEPA sind die günstigsten Zahlungsmethoden<br>Wähle beim Besteuerungsort immer ‚Outside the EU and AU‘</span>`;
                    const codeGG = kinguinDiscountCode;
                    const codeAKS = kinguinDiscountCodeAKS;
                    const validGG = isValidCode(codeGG);
                    const validAKS = isValidCode(codeAKS);
                    let combinedCodeDisplay = '';
                    if (validGG && validAKS) {
                        if (codeGG.toLowerCase() === codeAKS.toLowerCase()) { combinedCodeDisplay = formatCodeSpan(codeGG); }
                        else { combinedCodeDisplay = `${formatCodeSpan(codeGG)}<span class="code-separator">oder</span>${formatCodeSpan(codeAKS)}`; }
                    } else if (validGG) { combinedCodeDisplay = formatCodeSpan(codeGG); }
                    else if (validAKS) { combinedCodeDisplay = formatCodeSpan(codeAKS); }
                    else { combinedCodeDisplay = formatCodeSpan(codeGG, false); }
                    couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${combinedCodeDisplay}`;
                    break;
                }
                case 'driffle.com': {
                    baseTextHtml = `<span class="hinweise-title">Hinweise</span> <span class="hinweise-details">Google Pay, Apple Pay oder Kredit-/Debitkarte sind die günstigsten Zahlungsmethoden</span>`;
                    const finalCode = driffleDiscountCode;
                    const codeDisplay = formatCodeSpan(finalCode, isValidCode(finalCode));
                    couponTextHtml = `<span class="hinweise-title">Gutscheincode</span> ${codeDisplay}`;
                    break;
                }
                default:
                    baseTextHtml = "";
                    couponTextHtml = "";
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

})();
