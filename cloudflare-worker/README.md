# NXT API Gateway - Cloudflare Worker

This Cloudflare Worker serves as an intelligent API gateway for the NXT New Day backend, providing edge-level analytics, AI features, and advanced routing capabilities.

## 🚀 Features

### ✅ Core Gateway Functions
- **Request Proxying** - Routes frontend requests to Coolify backend
- **CORS Handling** - Automatic CORS headers for all API routes
- **Health Checks** - Built-in endpoint monitoring

### 📊 Analytics & Monitoring
- **Real-time Analytics** - Request/response logging with KV storage
- **Performance Metrics** - Response time tracking
- **Geographic Analytics** - User location and edge node data
- **Error Tracking** - Automatic error logging and alerting

### 🤖 AI Features
- **Anomaly Detection** - Identifies unusual response patterns
- **Predictive Routing** - Smart traffic routing based on geography
- **Rate Limiting** - Intelligent abuse prevention

### 🛡️ Security & Performance
- **Rate Limiting** - Per-IP request limiting (100 req/15min)
- **Edge Caching** - Cache GET requests for 5 minutes
- **Bot Protection** - Basic bot detection and filtering
- **SSL/TLS** - Automatic HTTPS termination

## 🏗️ Architecture

```
[Vercel Frontend] → [Cloudflare Worker] → [Coolify Backend]
                                      ↓
                              [Analytics & AI]
```

## 📋 Quick Setup

### 1. Install Dependencies
```bash
cd cloudflare-worker
npm install
```

### 2. Configure KV Namespaces
Create these KV namespaces in Cloudflare dashboard:
- `ANALYTICS_KV` - Stores request analytics
- `CACHE_KV` - Edge caching
- `RATE_LIMIT_KV` - Rate limiting data

### 3. Update Configuration
Edit `wrangler.toml`:
- Set your actual backend URL
- Configure KV namespace IDs
- Set environment variables

### 4. Deploy
```bash
# Development
npm run dev

# Deploy to production
npm run deploy

# Deploy to staging
npm run deploy:staging
```

## 🔧 Configuration

### Environment Variables
Set these in Cloudflare dashboard:
- `BACKEND_URL` - Your Coolify backend URL
- `JWT_SECRET` - For token validation (optional)
- `API_KEYS` - Comma-separated API keys (optional)

### KV Storage Structure
- **Analytics**: `analytics:{timestamp}:{id}` → Request logs
- **Cache**: `cache:{method}:{url}` → Cached responses
- **Rate Limits**: `rate_limit:{ip}` → Request timestamps

## 📊 Analytics Dashboard

Access analytics via KV queries:
```javascript
// Get recent analytics
const keys = await ANALYTICS_KV.list({ prefix: 'analytics:' })
const logs = await Promise.all(keys.keys.map(k => ANALYTICS_KV.get(k)))
```

## 🎯 Usage Examples

### Frontend Integration
```javascript
// Your frontend will call the Cloudflare Worker
const response = await fetch('https://api.nxtdotx.co.za/api/suppliers')
```

### Custom Headers Added
- `X-RateLimit-Remaining` - Rate limit info
- `X-Cache` - Cache status (HIT/MISS)
- `X-Forwarded-For` - Original client IP

## 🔍 Monitoring

### Health Check
```bash
curl https://api.nxtdotx.co.za/health
```

### Analytics Query
```bash
wrangler kv:key list --binding ANALYTICS_KV
```

## 🚨 Troubleshooting

### Common Issues
1. **CORS errors** - Check CORS headers in response
2. **Rate limiting** - Monitor `X-RateLimit-Remaining` header
3. **Cache issues** - Check `X-Cache` header
4. **Backend unreachable** - Verify `BACKEND_URL` in wrangler.toml

### Debug Commands
```bash
# View logs
npm run tail

# Test locally
npm run dev
```

## 🔄 Architecture Benefits

| Feature | Without Worker | With Worker |
|---------|----------------|-------------|
| Analytics | Backend only | Edge + Backend |
| Rate Limiting | Backend only | Edge enforcement |
| Caching | Backend only | Edge caching |
| Security | Backend only | Edge + Backend |
| Performance | Single region | Global edge |

## 📈 Next Steps

1. **Deploy Worker** to Cloudflare
2. **Configure KV namespaces**
3. **Update frontend** to use Worker URL
4. **Monitor analytics** via KV queries
5. **Scale caching** based on usage patterns

## 🎛️ Advanced Features

### Custom Rate Limiting
Modify `CONFIG.RATE_LIMIT` in `src/index.js`

### AI Enhancements
- Add machine learning models
- Implement predictive caching
- Add user behavior analysis

### Security Features
- JWT token validation
- API key management
- Geographic restrictions
- Bot detection enhancement