// ==UserScript==
// @name            Guthaben Checker (Beta)
// @namespace       http://tampermonkey.net/
// @version         0.7.1
// @description     Checkt Guthabenseiten
// @author          kenixa
// @match           https://www.eneba.com/*
// @match           https://www.kinguin.net/*
// @match           https://www.gamivo.com/*
// @updateURL       https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @downloadURL     https://raw.githubusercontent.com/kenixa/GuthabenChecker/main/GuthabenChecker.user.js
// @grant           none
// ==/UserScript==

(function () {
    'use strict';

    const STYLES = {
        colors: {
            textColor: '#2D2D2D',
            errorColor: 'rgba(64, 64, 64, 0.8)',
        },
        fonts: {
            default: "'Roboto', sans-serif",
        }
    };

    const createHoverEffect = (element, boxShadow) => {
        element.addEventListener('mouseenter', () => {
            element.style.boxShadow = boxShadow;
        });
        element.addEventListener('mouseleave', () => {
            element.style.boxShadow = '0px 15px 30px rgba(0, 0, 0, 0.2), 0px 5px 10px rgba(0, 0, 0, 0.1), 0 0 8px rgba(255,255,255,0.3)';
        });
    };

    const siteConfig = {
        'eneba.com': {
            paymentPageUrl: (window.location.href.includes('/de') ? "https://www.eneba.com/de/checkout/payment" : "https://www.eneba.com/checkout/payment"),
            getElements: () => ({
                paymentMethodClassElement: document.querySelector('.sTYIOc'),
                selectedProducts: document.querySelectorAll('span.QkJSBi'),
            }),
        },
        'kinguin.net': {
            paymentPageUrl: (window.location.href.includes('/de') ? "https://www.kinguin.net/de/new-checkout/review" : "https://www.kinguin.net/new-checkout/review"),
            getElements: () => {
                const totalTexts = ['Gesamtsumme', 'Grand total'];
                const totalElement = [...document.querySelectorAll('*')]
                    .find(el => totalTexts.includes(el.textContent.trim()));

                const summarySection = document.getElementById("summarySection");
                const relevantTotalElement = summarySection?.contains(totalElement) ? totalElement : document.querySelector('*');

                const paymentMethodClassElement = relevantTotalElement?.closest('span')?.nextElementSibling ??
                    relevantTotalElement?.closest('span')?.querySelector('.price-mobile');

                const quantityInputs = document.querySelectorAll('input[type="number"][data-test="quantityInput"]');

                return {
                    paymentMethodClassElement,
                    selectedProducts: [...quantityInputs],
                };
            },
        },
        'gamivo.com': {
            paymentPageUrl: (window.location.href.includes('/de') ? "https://www.gamivo.com/de/cart" : "https://www.gamivo.com/cart"),
            getElements: () => {
                const paymentMethodClassElement = [...document.querySelectorAll('*')]
                    .find(el => el.textContent.trim() === "Total" || el.textContent.trim() === "Insgesamt")?.nextElementSibling;

                const productCountElement = document.querySelector('input[data-testid="cart-products__count"]');

                return {
                    paymentMethodClassElement: paymentMethodClassElement,
                    selectedProducts: productCountElement ? [productCountElement] : [],
                }
            },
        }
    };

    const currentSite = window.location.hostname.includes('kinguin')
        ? 'kinguin.net'
        : window.location.hostname.includes('gamivo')
            ? 'gamivo.com'
            : 'eneba.com';

    const config = siteConfig[currentSite];

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
                `PlayStation Network Card PSN EUR DE €${c}`
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
                `Nintendo eShop EUR €${c}`
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
                `Airbnb Gift Card EUR DE €${c}`
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
                `Amazon Gift Card EUR DE €${c}`
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
                `Blizzard Gift Card EUR EU €${c}`
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
                `Google Play Gift Card EUR EU €${c}`
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
                `IKEA Gift Card EUR DE €${c}`
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
                `App Store & iTunes EUR DE €${c}`
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
                `Netflix Gift Card EUR EU €${c}`
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
                `Steam Gift Card EUR EU €${c}`
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
                `Xbox Live Gift Card EUR DE €${c}`
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
                `Zalando Gift Card EUR EU €${c}`
            ]
        },
        itunesTRY: {
            name: "iTunes Türkei",
            factors: [0.9600, 1.0000, 1.0400, 1.0401],
            thresholds: [0.9600, 1.0000, 1.0400],
            currency: "TRY",
            text: (c) => [
                `Apple iTunes Gift Card ${c} TRY iTunes Key TURKEY`,
                `iTunes ₺${c} TR Card`
            ]
        },
        netflixTRY: {
            name: "Netflix Türkei",
            factors: [1.02, 1.06, 1.10, 1.11],
            thresholds: [1.02, 1.06, 1.10],
            currency: "TRY",
            text: (c) => [
                `Netflix Gift Card ${c} TRY Key TURKEY`,
                `Netflix TRY ${c} Gift Card TR`
            ]
        },
    };

    const CATEGORIES = Array.from({ length: 2000 }, (_, i) => (i + 1).toString());

    let previousState = null;
    let userClosedWindow = false;
let tryDayPrice = 0.024;

const fetchExchangeRate = async () => {
    try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/TRY');

        if (!response.ok) {
            throw new Error(`API-Anfrage fehlgeschlagen: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.rates && data.rates.EUR) {
            tryDayPrice = data.rates.EUR;
            console.log(`Aktueller Wechselkurs (von API): 1 TRY = ${tryDayPrice} EUR`);
        } else {
            console.warn('Wechselkurs konnte nicht abgerufen werden (ungültige API-Antwort). Verwende Standardwert.');
        }
    } catch (error) {
        console.error('Fehler beim Abrufen des Wechselkurses:', error);
        console.warn('Verwende Standardwert für TRY-EUR: 0.027');
    }
};

fetchExchangeRate();

setInterval(fetchExchangeRate, 30 * 60 * 1000);


    const style = document.createElement('style');
    style.textContent = `
    #resultWindow {
        font-family: 'Roboto', sans-serif !important;
        font-size: 16px !important;
        line-height: 1.6 !important;
        text-align: center;
    }
    #resultWindow h1 {
        font-size: 2em;
        margin-bottom: 0.2em;
    }
    #resultWindow .price-category {
        font-size: 3em !important;
    }
    #resultWindow .fehler {
        font-size: 3em !important;
        color: red;
    }
    #resultWindow hr {
        border: none;
        border-top: 1px solid #2D2D2D;
        margin: 0.8em auto;
        width: 90%;
    }
    #resultWindow b {
        font-weight: bold;
    }
    #resultWindow u {
        text-decoration: underline;
    }

`;
    document.head.appendChild(style);

    const resultWindow = document.createElement('div');
    resultWindow.id = 'resultWindow';
    Object.assign(resultWindow.style, {
        position: 'fixed',
        bottom: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '580px',
        maxHeight: '600px',
        minHeight: '225px',
        backdropFilter: 'blur(10px)',
        '-webkit-backdrop-filter': 'blur(10px)',
        boxShadow: '0px 15px 30px rgba(0, 0, 0, 0.2), 0px 5px 10px rgba(0, 0, 0, 0.1), 0 0 8px rgba(255,255,255,0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        color: STYLES.colors.textColor,
        padding: '20px',
        borderRadius: '12px',
        fontFamily: STYLES.fonts.default,
        animation: 'slideUp 0.5s ease-out',
        transition: 'opacity 0.3s ease, box-shadow 0.3s ease',
        zIndex: '10000',
        display: 'none',
        textAlign: 'center',
    });
    createHoverEffect(resultWindow, '0px 18px 35px rgba(0, 0, 0, 0.4), 0 0 12px rgba(255,255,255,0.4)');

    const closeButton = document.createElement('div');
    closeButton.innerHTML = 'X';
    Object.assign(closeButton.style, {
        position: 'absolute',
        top: '0px',
        right: '4px',
        cursor: 'pointer',
        color: '#2D2D2D',
        fontSize: '1.1em',
        fontWeight: 'bold',
        padding: '2px',
        transition: 'transform 0.2s ease',
    });

    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.transform = 'scale(1.2)';
    });
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.transform = 'scale(1)';
    });

    closeButton.addEventListener('click', () => {
        resultWindow.style.display = 'none';
        userClosedWindow = true;
    });

    document.body.appendChild(resultWindow);

    const kinguinRemover = () => {
        const selectors = [
            'div.sc-eZKLwX.gyWTdX',
            'div.sc-eqUgKp.uHfgn'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                element.remove();
            }
        }
    };

    const getProductCount = (selectedProducts) => {
        if (currentSite === 'eneba.com') {
            return Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.innerText, 10) || 0), 0);
        } else if (currentSite === 'kinguin.net') {
            return Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.value, 10) || 0), 0);
        } else {
            return Array.from(selectedProducts).reduce((acc, el) => acc + (parseInt(el.value, 10) || 0), 0);
        }
    };

    const displayError = (message) => {
        resultWindow.innerHTML = `
        <b><span class="fehler">Fehler</span></b>
        <hr style="border:solid #FFFFFF 0.5px; margin-top: 0.5em; margin-bottom: 0.5em;">
        <p style="color: white; margin-top: 0.5em;">${message}</p>
    `;
        Object.assign(resultWindow.style, {
            backgroundColor: STYLES.colors.errorColor,
            display: 'block',
        });
    };

    const checkMultipleProducts = () => {
        if (!['eneba.com', 'kinguin.net', 'gamivo.com'].includes(currentSite)) {
            return false;
        }

        const uniqueProductNames = new Set();

        const siteSelectors = {
            'eneba.com': () => {
                const selectedProductSpans = config.getElements().selectedProducts;
                selectedProductSpans.forEach(span => {
                    const listItem = span.closest('li.kUNEHW');
                    if (listItem) {
                        const productName = listItem.querySelector('a.oxEG6i.link')?.innerText.trim();
                        if (productName) uniqueProductNames.add(productName);
                    }
                });
            },
            'kinguin.net': () => {
                const itemsWrapper = document.querySelector('div[data-test="itemsWrapper"]');
                itemsWrapper?.querySelectorAll('div.sc-kOcGyv.dqrtgT .sc-eQxpLG.cXdgIz').forEach(productDiv => {
                    const productName = productDiv.querySelector('a[data-test="productName"]')?.innerText.trim();
                    if (productName) uniqueProductNames.add(productName);
                });
            },
            'gamivo.com': () => {
                const cartGridMain = document.querySelector('.cart-grid__main');
                cartGridMain?.querySelectorAll('.cart-basket-items__box').forEach(item => {
                    const productName = item.querySelector('.cart-product__title')?.innerText.trim();
                    if (productName) uniqueProductNames.add(productName);
                });
            }
        };

        siteSelectors[currentSite]?.();

        if (uniqueProductNames.size > 1) {
            displayError('Mehrere verschiedene Produkte im Warenkorb erkannt.');
            return true;
        }
        return false;
    };



    const processLogic = () => {
        const { selectedProducts, paymentMethodClassElement } = config.getElements();

        if (checkMultipleProducts()) {
            return;
        }

        if (!isRelevantProduct()) {
            resultWindow.style.display = 'none';
            previousState = null;
            return;
        }

        if (!paymentMethodClassElement) {
            previousState = null;
            return;
        }

        const product = findMatchingProduct();
        if (!product) {
            resultWindow.style.display = 'none';
            previousState = null;
            return;
        }

        const productCount = getProductCount(selectedProducts);
        const paymentMethod = parseFloat(paymentMethodClassElement.innerText.replace(/[^\d.,]/g, '').replace(',', '.').trim());

        if (isNaN(paymentMethod)) {
            previousState = null;
            return;
        }

        const currentState = {
            product: product.name,
            productCount,
            paymentMethod
        };

        const getSiteSpecificText = () => {
            switch (currentSite) {
                case 'gamivo.com':
                    return "<em><b>Hinweis:</b> Deaktiviere das Kundenschutzprogramm<br>PayPal ist die günstigste Zahlungsart</em>";
                case 'eneba.com':
                    return "<em><b>Hinweis:</b> Google Pay und Apple Pay sind die günstigsten Zahlungsarten<br>EnebaWallet funktioniert nicht mit Gutscheincode</em>";
                case 'kinguin.net':
                    return "<em><b>Hinweis:</b> Klarna ist die günstigste Zahlungsart<br>Wähle immer Outside the EU and AU bei Besteuerungsort</em>";
                default:
                    return "";
            }
        };
        const siteSpecificText = getSiteSpecificText();

        if (!statesAreEqual(previousState, currentState)) {
            CATEGORIES.forEach(category => {
                if (product.text(category).some(targetText => document.body.innerText.includes(targetText))) {
                    let factor, priceCategory, orientationText;
                    const numericCategory = parseFloat(category);

                    if (product.currency === "TRY") {
                        // TRY-spezifische Logik
                        factor = (paymentMethod / (numericCategory * productCount * tryDayPrice)).toFixed(4);
                        priceCategory = determinePriceCategoryTRY(factor, product.thresholds);
                        orientationText = getOrientationTextTRY(category, productCount, product); // Produkt übergeben

                    } else {
                        // EUR-spezifische Logik
                        factor = (paymentMethod / (numericCategory * productCount)).toFixed(4);
                        priceCategory = determinePriceCategoryEUR(factor, product.thresholds);
                        orientationText = getOrientationTextEUR(category, productCount, product); // Produkt übergeben
                    }

                    const infoText = `<b><span class="price-category">${priceCategory}</span></b><hr style="border:solid #2D2D2D 0.5px; margin-top: 0.5em; margin-bottom: 0.5em;">${siteSpecificText}<hr style="border:solid #2D2D2D 0.5px; margin-top: 0.5em; margin-bottom: 0.5em;">Faktor = ${factor}<br><b><u>Orientierungshilfe</u></b><br> ${orientationText}<br>`;
                    displayResult(infoText, priceCategory);
                }
            });
            previousState = currentState;
        }
    };


    const statesAreEqual = (state1, state2) => {
        if (state1 === null || state2 === null) return false;
        return (
            state1.product === state2.product &&
            state1.productCount === state2.productCount &&
            state1.paymentMethod === state2.paymentMethod
        );
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


    const getCrystalColor = (priceCategory) => {
        switch (priceCategory) {
            case 'Top': return 'rgba(40, 167, 69, 0.70)';
            case 'Gut': return 'rgba(204, 255, 102, 0.70)';
            case 'Okay': return 'rgba(255, 179, 102, 0.70)';
            case 'Schlecht': return 'rgba(220, 53, 69, 0.70)';
            default: return 'rgba(64, 64, 64, 0.3)';
        }
    };

    const displayResult = (content, priceCategory) => {
        if (!content.trim()) {
            resultWindow.style.display = 'none';
            return;
        }

        if (!userClosedWindow) {
            resultWindow.innerHTML = content;
            resultWindow.style.backgroundColor = getCrystalColor(priceCategory);
            resultWindow.appendChild(closeButton);
            resultWindow.style.display = 'block';
        }
    };

    const updateUIVisibility = () => {
        const isOnPaymentPage = window.location.href.includes(config.paymentPageUrl);

        if (!isOnPaymentPage) {
            if (previousState !== null) {
                previousState = null;
                resultWindow.style.display = 'none';
            }
            return;
        }

        kinguinRemover();
        userClosedWindow = false;
        processLogic();
    };

    updateUIVisibility();
    setInterval(updateUIVisibility, 500);
})();
