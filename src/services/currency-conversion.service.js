import { db } from '../config/database.js'
import { eq, and, sql, desc, gte } from 'drizzle-orm'

/**
 * Multi-Currency Price Conversion Service
 * Handles currency conversion for supplier price lists with support for
 * real-time rates, historical data, and caching for performance
 */

// ==================== SUPPORTED CURRENCIES ====================

export const SUPPORTED_CURRENCIES = {
  USD: { symbol: '$', name: 'US Dollar', code: 'USD', precision: 2 },
  EUR: { symbol: '€', name: 'Euro', code: 'EUR', precision: 2 },
  GBP: { symbol: '£', name: 'British Pound', code: 'GBP', precision: 2 },
  ZAR: { symbol: 'R', name: 'South African Rand', code: 'ZAR', precision: 2 },
  JPY: { symbol: '¥', name: 'Japanese Yen', code: 'JPY', precision: 0 },
  CAD: { symbol: 'C$', name: 'Canadian Dollar', code: 'CAD', precision: 2 },
  AUD: { symbol: 'A$', name: 'Australian Dollar', code: 'AUD', precision: 2 },
  CHF: { symbol: 'CHF', name: 'Swiss Franc', code: 'CHF', precision: 2 },
  CNY: { symbol: '¥', name: 'Chinese Yuan', code: 'CNY', precision: 2 },
  INR: { symbol: '₹', name: 'Indian Rupee', code: 'INR', precision: 2 }
}

export const DEFAULT_CURRENCY = 'USD'
export const BASE_CURRENCY = 'USD' // Base currency for rate calculations

// ==================== EXCHANGE RATE MANAGEMENT ====================

// In-memory cache for exchange rates (in production, use Redis)
let exchangeRateCache = new Map()
let lastRateUpdate = null
const CACHE_DURATION = 60 * 60 * 1000 // 1 hour in milliseconds

/**
 * Get current exchange rate between two currencies
 */
export async function getExchangeRate(fromCurrency, toCurrency, options = {}) {
  try {
    const {
      useCache = true,
      forceRefresh = false,
      historicalDate = null
    } = options

    // Same currency, rate is 1
    if (fromCurrency === toCurrency) {
      return {
        success: true,
        data: {
          rate: 1,
          fromCurrency,
          toCurrency,
          timestamp: new Date(),
          source: 'direct'
        }
      }
    }

    // Validate currencies
    if (!SUPPORTED_CURRENCIES[fromCurrency] || !SUPPORTED_CURRENCIES[toCurrency]) {
      return {
        success: false,
        error: 'Unsupported currency',
        message: `One or both currencies not supported: ${fromCurrency}, ${toCurrency}`
      }
    }

    // Check cache first (unless force refresh or historical date)
    if (useCache && !forceRefresh && !historicalDate) {
      const cachedRate = getCachedRate(fromCurrency, toCurrency)
      if (cachedRate) {
        return {
          success: true,
          data: cachedRate
        }
      }
    }

    // Get rate from data source
    let rateData
    if (historicalDate) {
      rateData = await getHistoricalExchangeRate(fromCurrency, toCurrency, historicalDate)
    } else {
      rateData = await getCurrentExchangeRate(fromCurrency, toCurrency)
    }

    // Cache the rate if it's current
    if (!historicalDate && useCache) {
      cacheExchangeRate(fromCurrency, toCurrency, rateData)
    }

    return {
      success: true,
      data: rateData
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get exchange rate'
    }
  }
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrency(amount, fromCurrency, toCurrency, options = {}) {
  try {
    const {
      roundingMode = 'round', // 'round', 'floor', 'ceil'
      precision = null, // Override default precision
      includeRateInfo = false,
      historicalDate = null
    } = options

    if (typeof amount !== 'number' || amount < 0) {
      return {
        success: false,
        error: 'Invalid amount',
        message: 'Amount must be a positive number'
      }
    }

    // Get exchange rate
    const rateResult = await getExchangeRate(fromCurrency, toCurrency, { 
      historicalDate 
    })

    if (!rateResult.success) {
      return rateResult
    }

    const rate = rateResult.data.rate
    const convertedAmount = amount * rate

    // Apply rounding and precision
    const targetCurrency = SUPPORTED_CURRENCIES[toCurrency]
    const finalPrecision = precision !== null ? precision : targetCurrency.precision
    
    let finalAmount
    switch (roundingMode) {
      case 'floor':
        finalAmount = Math.floor(convertedAmount * Math.pow(10, finalPrecision)) / Math.pow(10, finalPrecision)
        break
      case 'ceil':
        finalAmount = Math.ceil(convertedAmount * Math.pow(10, finalPrecision)) / Math.pow(10, finalPrecision)
        break
      default:
        finalAmount = Math.round(convertedAmount * Math.pow(10, finalPrecision)) / Math.pow(10, finalPrecision)
    }

    const result = {
      originalAmount: amount,
      convertedAmount: finalAmount,
      fromCurrency,
      toCurrency,
      exchangeRate: rate,
      conversionTimestamp: new Date()
    }

    if (includeRateInfo) {
      result.rateInfo = rateResult.data
    }

    return {
      success: true,
      data: result
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to convert currency'
    }
  }
}

/**
 * Convert multiple amounts in batch
 */
export async function convertCurrencyBatch(conversions, options = {}) {
  try {
    const {
      skipErrors = true,
      includeRateInfo = false
    } = options

    if (!Array.isArray(conversions) || conversions.length === 0) {
      return {
        success: false,
        error: 'Invalid conversions array',
        message: 'Conversions must be a non-empty array'
      }
    }

    const results = []
    const errors = []

    for (let i = 0; i < conversions.length; i++) {
      const conversion = conversions[i]
      
      try {
        const result = await convertCurrency(
          conversion.amount,
          conversion.fromCurrency,
          conversion.toCurrency,
          { ...options, includeRateInfo }
        )

        if (result.success) {
          results.push({
            index: i,
            originalRequest: conversion,
            ...result.data
          })
        } else if (!skipErrors) {
          throw new Error(result.error)
        } else {
          errors.push({
            index: i,
            originalRequest: conversion,
            error: result.error
          })
        }
      } catch (error) {
        if (!skipErrors) {
          throw error
        }
        errors.push({
          index: i,
          originalRequest: conversion,
          error: error.message
        })
      }
    }

    return {
      success: errors.length === 0 || skipErrors,
      data: {
        conversions: results,
        errors,
        summary: {
          total: conversions.length,
          successful: results.length,
          failed: errors.length
        }
      },
      message: `Converted ${results.length} of ${conversions.length} amounts`
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to perform batch currency conversion'
    }
  }
}

/**
 * Get supported currencies with current rates to base currency
 */
export async function getSupportedCurrenciesWithRates(baseCurrency = BASE_CURRENCY) {
  try {
    const currencies = []

    for (const [code, info] of Object.entries(SUPPORTED_CURRENCIES)) {
      const rateResult = await getExchangeRate(baseCurrency, code)
      
      currencies.push({
        code,
        name: info.name,
        symbol: info.symbol,
        precision: info.precision,
        rateFromBase: rateResult.success ? rateResult.data.rate : null,
        rateTimestamp: rateResult.success ? rateResult.data.timestamp : null,
        isBase: code === baseCurrency
      })
    }

    return {
      success: true,
      data: {
        baseCurrency,
        currencies,
        lastUpdated: new Date()
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get supported currencies with rates'
    }
  }
}

/**
 * Get historical exchange rates for a currency pair
 */
export async function getExchangeRateHistory(fromCurrency, toCurrency, options = {}) {
  try {
    const {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      endDate = new Date(),
      interval = 'daily' // 'daily', 'weekly', 'monthly'
    } = options

    // In a real implementation, this would fetch from a historical rates database
    // For now, return mock historical data
    const history = generateMockHistoricalRates(fromCurrency, toCurrency, startDate, endDate, interval)

    return {
      success: true,
      data: {
        fromCurrency,
        toCurrency,
        interval,
        period: {
          start: startDate,
          end: endDate
        },
        rates: history
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to get exchange rate history'
    }
  }
}

/**
 * Format currency amount with proper symbol and formatting
 */
export function formatCurrencyAmount(amount, currency, options = {}) {
  const {
    showSymbol = true,
    showCode = false,
    locale = 'en-US'
  } = options

  const currencyInfo = SUPPORTED_CURRENCIES[currency]
  if (!currencyInfo) {
    return amount.toString()
  }

  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: currencyInfo.precision,
      maximumFractionDigits: currencyInfo.precision
    })

    let formatted = formatter.format(amount)

    if (!showSymbol) {
      // Remove currency symbol
      formatted = formatted.replace(/[^\d.,\s-]/g, '').trim()
    }

    if (showCode) {
      formatted += ` ${currency}`
    }

    return formatted
  } catch (error) {
    // Fallback formatting
    const rounded = amount.toFixed(currencyInfo.precision)
    return showSymbol ? `${currencyInfo.symbol}${rounded}` : rounded
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get cached exchange rate
 */
function getCachedRate(fromCurrency, toCurrency) {
  if (!lastRateUpdate || Date.now() - lastRateUpdate > CACHE_DURATION) {
    return null
  }

  const key = `${fromCurrency}-${toCurrency}`
  return exchangeRateCache.get(key)
}

/**
 * Cache exchange rate
 */
function cacheExchangeRate(fromCurrency, toCurrency, rateData) {
  const key = `${fromCurrency}-${toCurrency}`
  exchangeRateCache.set(key, rateData)
  
  // Also cache the reverse rate
  const reverseKey = `${toCurrency}-${fromCurrency}`
  const reverseRateData = {
    ...rateData,
    rate: 1 / rateData.rate,
    fromCurrency: toCurrency,
    toCurrency: fromCurrency
  }
  exchangeRateCache.set(reverseKey, reverseRateData)
  
  lastRateUpdate = Date.now()
}

/**
 * Get current exchange rate from external source or database
 */
async function getCurrentExchangeRate(fromCurrency, toCurrency) {
  // In production, this would call a real currency API or database
  // For now, return mock rates
  const mockRates = getMockExchangeRates()
  
  let rate = 1
  
  // Convert via USD if needed
  if (fromCurrency !== BASE_CURRENCY && toCurrency !== BASE_CURRENCY) {
    const fromToUSD = mockRates[fromCurrency] || 1
    const toFromUSD = 1 / (mockRates[toCurrency] || 1)
    rate = fromToUSD * toFromUSD
  } else if (fromCurrency === BASE_CURRENCY) {
    rate = 1 / (mockRates[toCurrency] || 1)
  } else if (toCurrency === BASE_CURRENCY) {
    rate = mockRates[fromCurrency] || 1
  }

  return {
    rate,
    fromCurrency,
    toCurrency,
    timestamp: new Date(),
    source: 'mock_api',
    provider: 'internal'
  }
}

/**
 * Get historical exchange rate
 */
async function getHistoricalExchangeRate(fromCurrency, toCurrency, date) {
  // In production, this would query historical rate database
  // For now, return a mock historical rate
  const currentRateResult = await getCurrentExchangeRate(fromCurrency, toCurrency)
  
  // Add some random variation for historical simulation
  const variation = (Math.random() - 0.5) * 0.1 // ±5% variation
  const historicalRate = currentRateResult.rate * (1 + variation)

  return {
    ...currentRateResult,
    rate: historicalRate,
    timestamp: new Date(date),
    source: 'historical_mock'
  }
}

/**
 * Mock exchange rates (USD base)
 */
function getMockExchangeRates() {
  return {
    EUR: 0.85,
    GBP: 0.73,
    ZAR: 18.5,
    JPY: 110.0,
    CAD: 1.25,
    AUD: 1.35,
    CHF: 0.92,
    CNY: 6.45,
    INR: 74.5
  }
}

/**
 * Generate mock historical rates
 */
function generateMockHistoricalRates(fromCurrency, toCurrency, startDate, endDate, interval) {
  const rates = []
  const daysDiff = Math.floor((endDate - startDate) / (24 * 60 * 60 * 1000))
  
  let intervalDays = 1
  if (interval === 'weekly') intervalDays = 7
  if (interval === 'monthly') intervalDays = 30

  const baseRate = getMockExchangeRates()[toCurrency] || 1
  
  for (let i = 0; i <= daysDiff; i += intervalDays) {
    const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
    const variation = (Math.random() - 0.5) * 0.1 // ±5% variation
    const rate = baseRate * (1 + variation)
    
    rates.push({
      date,
      rate: Math.round(rate * 10000) / 10000, // 4 decimal places
      open: rate * 0.999,
      high: rate * 1.005,
      low: rate * 0.995,
      close: rate
    })
  }

  return rates
}

/**
 * Clear rate cache (useful for testing or forced refresh)
 */
export function clearRateCache() {
  exchangeRateCache.clear()
  lastRateUpdate = null
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    cacheSize: exchangeRateCache.size,
    lastUpdate: lastRateUpdate,
    cacheAge: lastRateUpdate ? Date.now() - lastRateUpdate : null,
    isExpired: lastRateUpdate ? Date.now() - lastRateUpdate > CACHE_DURATION : true
  }
}

export default {
  getExchangeRate,
  convertCurrency,
  convertCurrencyBatch,
  getSupportedCurrenciesWithRates,
  getExchangeRateHistory,
  formatCurrencyAmount,
  clearRateCache,
  getCacheStats,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
  BASE_CURRENCY
}