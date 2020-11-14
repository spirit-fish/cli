# ![Spirit Fish logo](https://cdn.jsdelivr.net/gh/spirit-fish/cli@main/spirit_fish_logo.svg)

## Spirit Fish: A futuristic environment for your browser-based JS apps

> Spirit Fish is a deployment and rendering environment backed by a powerful CDN. Our approach is different to Vercel or Netlify in that we leverage the power of the browser to server render any type JS of project, and cache the result at the edge. No buy in to heavy-handed frameworks or expensive build platforms necessary!
>
> Build your JS project how you like - if it works in the browser, it works with Spirit Fish. Simply create a renderer in our dashboard, push your build via our CLI, and point your domain at our records.
>
> All projects come with a generous free usage tier – so [getting started](https://intercom.help/spirit-fish/en/collections/1930477-getting-started) is free.

![npm](https://img.shields.io/npm/v/@spirit-fish/cli) ![Downloads](https://img.shields.io/npm/dm/@spirit-fish/cli) [![Follow on twitter](https://img.shields.io/twitter/follow/sanctucompu?style=flat&color=blue)](https://twitter.com/sanctucompu)

## Quickstart

Get started from the command line:

```bash
npm i -g @spirit-fish/cli && spirit-fish help
```

Or head over to [spirit.fish](https://www.spirit.fish) to setup your first renderer.

- Watch our [getting started video](TODO).
- [Read the introduction](https://intercom.help/spirit-fish/en/) in our documentation.

## Table of contents

- [Quickstart](#quickstart)
- [Table of contents](#table-of-contents)
- [Key Features](#key-features)
  - [A Powerful Dashboard](#a-powerful-dashboard)
  - [Deployments](#deployments)
  - [On-the-fly Server Rendering](#on-the-fly-server-rendering)
  - [Global Content Delivery](#global-content-delivery)
- [Stay in the Loop](#stay-in-the-loop)

## Key Features

![Sanity Studio](https://www.spiritfish.xyz/assets/dashboard-62a2b3d6167d0792ee9737f7a040c3b964160b1bf4185d43e449683a0586b9a0.png)

### [A Powerful Dashboard](https://www.spirit.fish)

Use our dashboard to setup your renderer, configure transforms, and setup your DNS for on-the-fly rendering. Create CDN invalidations, and preview your project before you go live.

### [Deployments](https://www.spirit.fish/features/deployments)

Use our zero-downtime deployments infrastructure to continuously push builds to your renderers.
- Free hosting with all Renderers
- Instant Rollbacks
- Zero Downtime Deploys
- Intelligent File Aliasing
- Version Fingerprinting

### [On-the-fly Server Rendering](https://www.spirit.fish/features/rendering)

Our approach to server rendering your apps is on-the-fly, using a headless browser

- No Code Changes Required
- CDN Backed Renders
- Inlines Critical CSS
- Supports zero-config Google AMP transforms
- Override Headers & Status Codes (301s, 404s, etc)
- Cache Requests at rendertime with our [XHR Cache](https://github.com/spirit-fish/xhr-cache)

### [Global Content Delivery](https://www.spirit.fish/features/cdn)

We cache your server-rendered pages, and static assets in our powerful edge cache.
- 29 countries across 6 continents
- 43 points of presence worldwide
- Automatic Brotli Compression
- Free & Instant SSL
- Native HTTP/2 Support
- Instant wildcard invalidations via our API, or Dashboard


## Stay in the Loop

- Read about advanced use cases on our [Blog](https://www.spirit.fish/blog)
- Spirit Fish is built in Manhattan, NYC by [Sanctuary Computer](https://www.sanctuary.computer).
- Follow us on Twitter, here:
![Follow on twitter](https://img.shields.io/twitter/follow/sanctucompu?style=flat&color=blue)
