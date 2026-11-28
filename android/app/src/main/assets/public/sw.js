/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "128d5026dc27f5ac8c907e69f0e7e0eb"
  }, {
    "url": "pwa-512x512.png",
    "revision": "72916b4cbf74836e838ca84427cb4abc"
  }, {
    "url": "pwa-192x192.png",
    "revision": "661ff5229832b2b5494475628a8b8e2d"
  }, {
    "url": "index.html",
    "revision": "bbba0ee4b4a01da5f7da2900b8831e0c"
  }, {
    "url": "icon.svg",
    "revision": "c7dde899d57f3985dd3f8b3f3fbe5447"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c0aac1cc672751b16adbd4af01e60b29"
  }, {
    "url": "src/assets/images/relay_brand_emblem_1795619570533.jpg",
    "revision": "759dc25154d38cfcb400cc4fa174217d"
  }, {
    "url": "src/assets/images/muse_agent_avatar_1795671239700.jpg",
    "revision": "0905e831f7265ddc1f35c607daf1390f"
  }, {
    "url": "src/assets/images/feed_icon_urgent_1795867370033.jpg",
    "revision": "cf58904c6b86ff35aa2041a3b57e8fb5"
  }, {
    "url": "src/assets/images/feed_icon_reminder_1795867368055.jpg",
    "revision": "dbcd80261ad8c820f8d082a40d2dd50d"
  }, {
    "url": "src/assets/images/feed_icon_paper_1795867366696.jpg",
    "revision": "66187d6a0d80b5ab1a02535d03465962"
  }, {
    "url": "src/assets/images/feed_icon_goal_1795867371552.jpg",
    "revision": "4bd0a5106af4e3f084ca7630b5f20827"
  }, {
    "url": "src/assets/images/feed_icon_dispatch_1795867368132.jpg",
    "revision": "7127ee4f522b2fced16d652a2217ea13"
  }, {
    "url": "src/assets/images/briefing_paper_systems_1795619568605.jpg",
    "revision": "d4ffb8e70a2b63fa42cab02e0b42a5b3"
  }, {
    "url": "src/assets/images/briefing_news_desk_1795619568085.jpg",
    "revision": "f0eecb18f50738b8391682ae6d5cf81d"
  }, {
    "url": "assets/web-DTCBFk32.js",
    "revision": null
  }, {
    "url": "assets/muse_agent_avatar_1795671239700-Bt96B81X.jpg",
    "revision": null
  }, {
    "url": "assets/index-D0Iisje6.js",
    "revision": null
  }, {
    "url": "assets/index-BZD4HugA.css",
    "revision": null
  }, {
    "url": "assets/feed_icon_urgent_1795867370033-CV8jtqPf.jpg",
    "revision": null
  }, {
    "url": "assets/feed_icon_reminder_1795867368055-BHVU_gbo.jpg",
    "revision": null
  }, {
    "url": "assets/feed_icon_paper_1795867366696-B8ThVaRg.jpg",
    "revision": null
  }, {
    "url": "assets/feed_icon_goal_1795867371552-DatUhIJ8.jpg",
    "revision": null
  }, {
    "url": "assets/feed_icon_dispatch_1795867368132-CAAqj6UD.jpg",
    "revision": null
  }, {
    "url": "assets/aistudio/image_a958484a.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_9d42f908.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_7f4e83d2.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_74570091.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_7419961b.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_6705023a.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_61c4c607.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_35bb8bc6.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_2d336bb4.png",
    "revision": null
  }, {
    "url": "assets/aistudio/image_0f342b38.png",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "c0aac1cc672751b16adbd4af01e60b29"
  }, {
    "url": "icon.svg",
    "revision": "c7dde899d57f3985dd3f8b3f3fbe5447"
  }, {
    "url": "pwa-192x192.png",
    "revision": "661ff5229832b2b5494475628a8b8e2d"
  }, {
    "url": "pwa-512x512.png",
    "revision": "72916b4cbf74836e838ca84427cb4abc"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "128d5026dc27f5ac8c907e69f0e7e0eb"
  }, {
    "url": "manifest.webmanifest",
    "revision": "2478f1fdba591fb50dfaf9a34cc4d914"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
