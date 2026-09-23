const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/18.6 Mobile/15E148 Safari/604.1";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Mobile Safari/537.36";

const URL_RE =
  /https?:\/\/[^\s，,、；;）)\]】》"'<>]+/i;

const ID_PATTERNS = [
  /\/share\/(?:video|slides|note)\/(\d+)/i,
  /\/(?:video|note)\/(\d+)/i,
  /[?&](?:modal_id|aweme_id)=(\d+)/i,
  /"aweme_id"\s*:\s*"?(\d+)"?/i
];


/* =========================================================
   基礎工具
========================================================= */

function responseJson(data, status = 200) {
  return Response.json(data, {
    status,

    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}


function isDouyinHost(hostname) {
  const host =
    String(hostname || "").toLowerCase();

  return (
    host === "douyin.com" ||
    host.endsWith(".douyin.com") ||
    host === "iesdouyin.com" ||
    host.endsWith(".iesdouyin.com")
  );
}


function firstUrl(text) {
  const match =
    String(text || "").match(URL_RE);

  return match
    ? match[0]
    : null;
}


function awemeIdFromText(text) {
  const value =
    String(text || "");

  for (const re of ID_PATTERNS) {
    const match =
      value.match(re);

    if (match) {
      return match[1];
    }
  }

  if (
    /^\d{15,22}$/.test(
      value.trim()
    )
  ) {
    return value.trim();
  }

  return null;
}


function contentHint(text) {
  const value =
    String(text || "")
      .toLowerCase();

  if (
    value.includes("/share/slides/") ||
    value.includes("/share/note/") ||
    value.includes("/note/") ||
    value.includes("is_slides=1")
  ) {
    return "slides";
  }

  if (
    value.includes("/share/video/") ||
    value.includes("/video/")
  ) {
    return "video";
  }

  return null;
}


function randomDigits(length) {
  let result = "";

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    result +=
      Math.floor(
        Math.random() * 10
      );
  }

  return result;
}


function randomString(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
    "abcdefghijklmnopqrstuvwxyz" +
    "0123456789";

  let result = "";

  for (
    let i = 0;
    i < length;
    i += 1
  ) {
    result +=
      chars[
        Math.floor(
          Math.random() *
          chars.length
        )
      ];
  }

  return result;
}


/* =========================================================
   短鏈 → 作品 ID
========================================================= */

async function resolveDouyinInput(rawInput) {
  const input =
    String(rawInput || "")
      .trim();

  if (!input) {
    throw new Error(
      "請先貼上抖音分享文字或鏈接"
    );
  }

  const pastedUrl =
    firstUrl(input);

  const existingId =
    awemeIdFromText(input);

  /*
   * 已經是完整長鏈時，
   * 可以直接取得 ID。
   */
  if (
    existingId &&
    (
      !pastedUrl ||
      !/v\.douyin\.com/i.test(
        pastedUrl
      )
    )
  ) {
    return {
      id: existingId,
      type: contentHint(input),
      finalUrl: pastedUrl || ""
    };
  }

  if (!pastedUrl) {
    throw new Error(
      "分享文字中找不到抖音鏈接"
    );
  }

  let current;

  try {
    current =
      new URL(pastedUrl);

  } catch {
    throw new Error(
      "抖音鏈接格式不正確"
    );
  }

  let combinedHints =
    input;

  for (
    let hop = 0;
    hop < 10;
    hop += 1
  ) {

    if (
      !isDouyinHost(
        current.hostname
      )
    ) {
      throw new Error(
        "這不是有效的抖音鏈接"
      );
    }

    combinedHints +=
      " " +
      current.href;

    const currentId =
      awemeIdFromText(
        current.href
      );

    if (currentId) {
      return {
        id: currentId,
        type:
          contentHint(
            combinedHints
          ),
        finalUrl:
          current.href
      };
    }

    const response =
      await fetch(
        current.href,
        {
          method: "GET",
          redirect: "manual",

          headers: {
            "User-Agent": IOS_UA,

            "Accept":
              "text/html,application/xhtml+xml,*/*",

            "Accept-Language":
              "zh-CN,zh;q=0.9",

            "Referer":
              "https://www.douyin.com/"
          }
        }
      );

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location =
        response.headers.get(
          "location"
        );

      if (!location) {
        break;
      }

      current =
        new URL(
          location,
          current
        );

      continue;
    }

    const html =
      await response.text();

    combinedHints +=
      " " +
      html.slice(
        0,
        120000
      );

    const htmlId =
      awemeIdFromText(
        html
      );

    if (htmlId) {
      return {
        id: htmlId,

        type:
          contentHint(
            combinedHints
          ),

        finalUrl:
          current.href
      };
    }

    break;
  }

  throw new Error(
    "無法從分享鏈接取得作品 ID"
  );
}


/* =========================================================
   圖文專用：
   slidesinfo API

   這是本次最重要的修正。
========================================================= */

async function getSlidesInfo(awemeId) {
  const diagnostics =
    [];

  /*
   * 目前抖音圖文 slidesinfo
   * 使用類似 75xxxxxxxxxxxxxxx
   * 的 web_id/device_id。
   */
  const webId =
    "75" +
    randomDigits(15);

  /*
   * 目前這條接口對圖文可使用
   * 長隨機 a_bogus 作為參數。
   */
  const aBogus =
    randomString(64);

  /*
   * 逐級嘗試。
   *
   * 第一條是目前圖文最重要的形式。
   */
  const urls = [
    (
      "https://www.iesdouyin.com/" +
      "web/api/v2/aweme/slidesinfo/" +
      "?reflow_source=reflow_page" +
      "&web_id=" +
      encodeURIComponent(webId) +
      "&device_id=" +
      encodeURIComponent(webId) +
      "&aweme_ids=%5B" +
      encodeURIComponent(awemeId) +
      "%5D" +
      "&request_source=200" +
      "&a_bogus=" +
      encodeURIComponent(aBogus)
    ),

    (
      "https://www.iesdouyin.com/" +
      "web/api/v2/aweme/slidesinfo/" +
      "?aweme_ids=%5B" +
      encodeURIComponent(awemeId) +
      "%5D" +
      "&request_source=200" +
      "&a_bogus=" +
      encodeURIComponent(aBogus)
    ),

    (
      "https://www.iesdouyin.com/" +
      "web/api/v2/aweme/slidesinfo/" +
      "?aweme_ids=%5B" +
      encodeURIComponent(awemeId) +
      "%5D"
    )
  ];

  for (
    let i = 0;
    i < urls.length;
    i += 1
  ) {
    try {
      const response =
        await fetch(
          urls[i],
          {
            method: "GET",
            redirect: "follow",
            cache: "no-store",

            headers: {
              "User-Agent":
                IOS_UA,

              "Accept":
                "application/json,text/plain,*/*",

              "Accept-Language":
                "zh-CN,zh;q=0.9",

              "Referer":
                `https://www.iesdouyin.com/share/slides/${awemeId}/`
            }
          }
        );

      const text =
        await response.text();

      diagnostics.push(
        `slidesinfo${i + 1}:${response.status}:${text.length}`
      );

      if (
        !response.ok
      ) {
        continue;
      }

      let data;

      try {
        data =
          JSON.parse(text);
      } catch {
        continue;
      }

      /*
       * 現行接口主要結構：
       *
       * {
       *   aweme_details: [...]
       * }
       */
      if (
        Array.isArray(
          data?.aweme_details
        ) &&
        data.aweme_details.length
      ) {
        return {
          item:
            data.aweme_details[0],

          source:
            "slidesinfo",

          diagnostics
        };
      }

      /*
       * 兼容其他返回形式。
       */
      if (
        Array.isArray(
          data?.item_list
        ) &&
        data.item_list.length
      ) {
        return {
          item:
            data.item_list[0],

          source:
            "slidesinfo-item-list",

          diagnostics
        };
      }

      if (
        Array.isArray(
          data?.aweme_list
        ) &&
        data.aweme_list.length
      ) {
        return {
          item:
            data.aweme_list[0],

          source:
            "slidesinfo-aweme-list",

          diagnostics
        };
      }

    } catch (error) {
      diagnostics.push(
        `slidesinfo${i + 1}:ERR`
      );
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


/* =========================================================
   普通影片：
   Mobile Feed API
========================================================= */

async function getMobileFeed(awemeId) {
  const diagnostics =
    [];

  const endpoints = [
    (
      "https://api5-normal-c-hl.amemv.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128"
    ),

    (
      "https://aweme.snssdk.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128"
    )
  ];

  for (
    const endpoint
    of endpoints
  ) {
    try {
      const response =
        await fetch(
          endpoint,
          {
            method: "GET",
            redirect: "follow",
            cache: "no-store",

            headers: {
              "User-Agent":
                ANDROID_UA,

              "Accept":
                "application/json",

              "Accept-Language":
                "zh-CN,zh;q=0.9"
            }
          }
        );

      diagnostics.push(
        `feed:${response.status}`
      );

      if (!response.ok) {
        continue;
      }

      const data =
        await response
          .json()
          .catch(
            () => null
          );

      if (!data) {
        continue;
      }

      const item =
        findAweme(
          data,
          awemeId
        );

      if (item) {
        return {
          item,
          source:
            "mobile-feed",
          diagnostics
        };
      }

    } catch {
      diagnostics.push(
        "feed:ERR"
      );
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


/* =========================================================
   SSR 後備
========================================================= */

function parseRouterData(html) {
  /*
   * 最直接、也是目前分享頁最常見形式。
   */
  const match =
    html.match(
      /window\._ROUTER_DATA\s*=\s*(.*?)<\/script>/s
    );

  if (!match?.[1]) {
    return null;
  }

  const raw =
    match[1]
      .trim()
      .replace(
        /;$/,
        ""
      );

  try {
    /*
     * 正常 JSON object。
     */
    if (
      raw.startsWith("{")
    ) {
      return JSON.parse(raw);
    }

    /*
     * 有些版本包成 JSON string。
     */
    if (
      raw.startsWith('"')
    ) {
      const inner =
        JSON.parse(raw);

      return JSON.parse(
        inner
      );
    }

  } catch {
    return null;
  }

  return null;
}


async function getSSR(
  awemeId
) {
  const diagnostics =
    [];

  /*
   * 很重要：
   * 即使作品本身是圖集，
   * share/video/{id}
   * 有時反而會返回完整圖集 JSON。
   */
  const paths = [
    "video",
    "slides",
    "note"
  ];

  for (
    const ua
    of [
      IOS_UA,
      ANDROID_UA
    ]
  ) {

    for (
      const type
      of paths
    ) {

      const url =
        `https://www.iesdouyin.com/share/${type}/${awemeId}/?from_ssr=1`;

      try {
        const response =
          await fetch(
            url,
            {
              redirect: "follow",
              cache: "no-store",

              headers: {
                "User-Agent":
                  ua,

                "Accept":
                  "text/html,application/xhtml+xml,*/*",

                "Accept-Language":
                  "zh-CN,zh;q=0.9",

                "Referer":
                  "https://www.douyin.com/"
              }
            }
          );

        const html =
          await response.text();

        diagnostics.push(
          `${type}:${response.status}:${html.length}:` +
          (
            html.includes(
              "_ROUTER_DATA"
            )
              ? "R"
              : "-"
          )
        );

        if (!response.ok) {
          continue;
        }

        const router =
          parseRouterData(
            html
          );

        if (!router) {
          continue;
        }

        /*
         * 最新與舊版常見固定 key。
         */
        const videoPage =
          router?.loaderData
            ?.["video_(id)/page"]
            ?.videoInfoRes;

        const notePage =
          router?.loaderData
            ?.["note_(id)/page"]
            ?.videoInfoRes;

        const direct =
          videoPage?.item_list?.[0] ||
          videoPage?.aweme_list?.[0] ||
          notePage?.item_list?.[0] ||
          notePage?.aweme_list?.[0];

        if (direct) {
          return {
            item: direct,
            source:
              `ssr-${type}`,
            diagnostics
          };
        }

        /*
         * 固定 key 不命中就遞迴掃描。
         */
        const found =
          findAweme(
            router,
            awemeId
          );

        if (found) {
          return {
            item: found,
            source:
              `ssr-${type}`,
            diagnostics
          };
        }

      } catch {
        diagnostics.push(
          `${type}:ERR`
        );
      }
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


/* =========================================================
   深度尋找作品
========================================================= */

function findAweme(
  node,
  targetId,
  seen = new Set(),
  depth = 0
) {

  if (
    node == null ||
    depth > 50
  ) {
    return null;
  }

  if (
    typeof node ===
    "object"
  ) {
    if (
      seen.has(node)
    ) {
      return null;
    }

    seen.add(node);
  }

  if (
    Array.isArray(node)
  ) {
    for (
      const value
      of node
    ) {
      const found =
        findAweme(
          value,
          targetId,
          seen,
          depth + 1
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof node !==
    "object"
  ) {
    return null;
  }

  const id =
    String(
      node.aweme_id ||
      node.awemeId ||
      node.item_id ||
      node.itemId ||
      ""
    );

  const hasMedia =
    Boolean(
      node.video ||
      node.images ||
      node.image_list ||
      node.image_infos ||
      node.image_post_info ||
      node.imagePostInfo
    );

  if (
    hasMedia &&
    (
      !id ||
      !targetId ||
      id === String(
        targetId
      )
    )
  ) {
    return node;
  }

  for (
    const value
    of Object.values(node)
  ) {
    const found =
      findAweme(
        value,
        targetId,
        seen,
        depth + 1
      );

    if (found) {
      return found;
    }
  }

  return null;
}


/* =========================================================
   URL 提取
========================================================= */

function urlList(value) {
  if (!value) {
    return [];
  }

  if (
    Array.isArray(value)
  ) {
    return value.filter(
      url =>
        typeof url ===
          "string" &&
        /^https?:\/\//i.test(
          url
        )
    );
  }

  if (
    typeof value ===
    "object"
  ) {
    return (
      urlList(
        value.url_list
      ).length
        ? urlList(
            value.url_list
          )
        : urlList(
            value.urlList
          )
    );
  }

  if (
    typeof value ===
      "string" &&
    /^https?:\/\//i.test(
      value
    )
  ) {
    return [value];
  }

  return [];
}


function chooseImageUrl(image) {
  const fields = [
    image?.download_url,
    image?.downloadUrl,
    image?.origin_url,
    image?.originUrl,
    image?.origin_image,
    image?.originImage,
    image?.display_image,
    image?.displayImage,
    image
  ];

  const all =
    [];

  for (
    const field
    of fields
  ) {
    for (
      const url
      of urlList(field)
    ) {
      if (
        !all.includes(url)
      ) {
        all.push(url);
      }
    }
  }

  if (!all.length) {
    return null;
  }

  /*
   * Safari 優先 JPG/JPEG，
   * 避免某些 WebP 下載後預覽麻煩。
   */
  const normal =
    all.find(
      url =>
        !/\.webp(?:\?|$)/i.test(
          url
        ) &&
        !/[?&]format=webp/i.test(
          url
        )
    );

  return normal ||
    all[0];
}


function imageArray(item) {
  const candidates = [
    item?.images,

    item?.image_list,

    item?.image_infos,

    item?.original_images,

    item?.image_post_info
      ?.images,

    item?.image_post_info
      ?.image_list,

    item?.imagePostInfo
      ?.images,

    item?.imagePostInfo
      ?.imageList
  ];

  return (
    candidates.find(
      value =>
        Array.isArray(value) &&
        value.length
    ) || []
  );
}


function cleanVideoUrl(url) {
  if (!url) {
    return null;
  }

  return url
    .replace(
      "/playwm/",
      "/play/"
    )
    .replace(
      "playwm",
      "play"
    );
}


function firstMediaUrl(value) {
  const list =
    urlList(value);

  if (!list.length) {
    return null;
  }

  const https =
    list.find(
      url =>
        url.startsWith(
          "https://"
        )
    );

  return https ||
    list[0];
}


function getBestVideo(item) {
  const video =
    item?.video || {};

  const candidates =
    [];

  const bitRates =
    video.bit_rate ||
    video.bitRate ||
    [];

  if (
    Array.isArray(
      bitRates
    )
  ) {
    for (
      const quality
      of bitRates
    ) {
      const addr =
        quality?.play_addr_h264 ||
        quality?.playAddrH264 ||
        quality?.play_addr ||
        quality?.playAddr;

      const raw =
        firstMediaUrl(
          addr
        );

      if (!raw) {
        continue;
      }

      candidates.push({
        url:
          cleanVideoUrl(
            raw
          ),

        width:
          Number(
            addr?.width ||
            quality?.width ||
            video?.width ||
            0
          ),

        height:
          Number(
            addr?.height ||
            quality?.height ||
            video?.height ||
            0
          ),

        bitrate:
          Number(
            quality?.bit_rate ||
            quality?.bitRate ||
            0
          ),

        size:
          Number(
            quality?.data_size ||
            quality?.dataSize ||
            0
          ),

        h265:
          Boolean(
            quality?.is_h265 ||
            quality?.isH265
          )
      });
    }
  }

  for (
    const addr
    of [
      video.play_addr_h264,
      video.playAddrH264,
      video.play_addr,
      video.playAddr,
      video.download_addr,
      video.downloadAddr
    ]
  ) {
    const raw =
      firstMediaUrl(addr);

    if (!raw) {
      continue;
    }

    candidates.push({
      url:
        cleanVideoUrl(raw),

      width:
        Number(
          addr?.width ||
          video?.width ||
          0
        ),

      height:
        Number(
          addr?.height ||
          video?.height ||
          0
        ),

      bitrate: 0,

      size:
        Number(
          addr?.data_size ||
          addr?.dataSize ||
          0
        ),

      h265: false
    });
  }

  const unique =
    [
      ...new Map(
        candidates.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ];

  /*
   * iPhone Safari 優先 H.264；
   * 同編碼下：
   *
   * 解析度 → bitrate → size
   */
  unique.sort(
    (a, b) => {
      if (
        a.h265 !== b.h265
      ) {
        return (
          Number(a.h265) -
          Number(b.h265)
        );
      }

      const pixelsA =
        a.width *
        a.height;

      const pixelsB =
        b.width *
        b.height;

      if (
        pixelsA !== pixelsB
      ) {
        return (
          pixelsB -
          pixelsA
        );
      }

      if (
        a.bitrate !==
        b.bitrate
      ) {
        return (
          b.bitrate -
          a.bitrate
        );
      }

      return (
        b.size -
        a.size
      );
    }
  );

  return unique[0] ||
    null;
}


function coverUrl(item) {
  const video =
    item?.video || {};

  const fields = [
    video.origin_cover,
    video.originCover,
    video.cover,
    video.dynamic_cover,
    video.dynamicCover,
    item?.cover
  ];

  for (
    const field
    of fields
  ) {
    const url =
      firstMediaUrl(
        field
      );

    if (url) {
      return url;
    }
  }

  return null;
}


/* =========================================================
   組裝前端資料
========================================================= */

function buildResult(
  item,
  awemeId,
  source
) {
  const rawImages =
    imageArray(item);

  const photos =
    rawImages
      .map(
        (
          image,
          index
        ) => {
          const url =
            chooseImageUrl(
              image
            );

          if (!url) {
            return null;
          }

          return {
            type:
              "photo",

            label:
              `圖片 ${index + 1}`,

            url,

            preview:
              url,

            width:
              Number(
                image?.width ||
                0
              ) || null,

            height:
              Number(
                image?.height ||
                0
              ) || null,

            format:
              "jpg"
          };
        }
      )
      .filter(Boolean);

  const authorData =
    item?.author ||
    item?.authorInfo ||
    {};

  const author =
    authorData.nickname ||
    authorData.name ||
    authorData.unique_id ||
    authorData.uniqueId ||
    "";

  const desc =
    String(
      item?.desc ||
      item?.caption ||
      item?.title ||
      ""
    ).trim();

  const id =
    String(
      item?.aweme_id ||
      item?.awemeId ||
      awemeId
    );

  /*
   * 有圖片就一定當圖文處理。
   */
  if (
    photos.length
  ) {
    return {
      ok: true,

      post: {
        id,
        type:
          "images",

        author,
        desc,

        cover:
          photos[0].preview,

        source
      },

      media:
        photos
    };
  }

  const video =
    getBestVideo(
      item
    );

  if (
    !video?.url
  ) {
    throw new Error(
      "已取得作品資料，但其中沒有可下載的圖片或影片地址"
    );
  }

  return {
    ok: true,

    post: {
      id,
      type:
        "video",

      author,
      desc,

      cover:
        coverUrl(item),

      source
    },

    media: [
      {
        type:
          "video",

        label:
          "影片",

        url:
          video.url,

        preview:
          coverUrl(item),

        width:
          video.width ||
          null,

        height:
          video.height ||
          null,

        bitrate:
          video.bitrate ||
          null,

        format:
          "mp4",

        quality:
          "最高可用畫質"
      }
    ]
  };
}


/* =========================================================
   主程式
========================================================= */

export default {
  async fetch(request) {
    if (
      request.method !==
      "GET"
    ) {
      return responseJson(
        {
          ok: false,
          error:
            "Method not allowed"
        },
        405
      );
    }

    try {
      const requestUrl =
        new URL(
          request.url
        );

      const rawInput =
        requestUrl
          .searchParams
          .get("url") ||
        "";

      const resolved =
        await resolveDouyinInput(
          rawInput
        );

      const diagnostics =
        [];

      /*
       * ==========================
       * 圖文：
       * slidesinfo 是第一優先
       * ==========================
       */
      if (
        resolved.type ===
        "slides"
      ) {
        const slides =
          await getSlidesInfo(
            resolved.id
          );

        diagnostics.push(
          ...slides.diagnostics
        );

        if (slides.item) {
          return responseJson(
            buildResult(
              slides.item,
              resolved.id,
              slides.source
            )
          );
        }

        /*
         * slidesinfo 如果臨時抽風，
         * 再試 SSR。
         */
        const ssr =
          await getSSR(
            resolved.id
          );

        diagnostics.push(
          ...ssr.diagnostics
        );

        if (ssr.item) {
          return responseJson(
            buildResult(
              ssr.item,
              resolved.id,
              ssr.source
            )
          );
        }

        /*
         * 最後再試 Mobile Feed。
         */
        const feed =
          await getMobileFeed(
            resolved.id
          );

        diagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {
          return responseJson(
            buildResult(
              feed.item,
              resolved.id,
              feed.source
            )
          );
        }

      } else {

        /*
         * ==========================
         * 普通影片：
         * 保留目前已經成功的 Feed
         * ==========================
         */
        const feed =
          await getMobileFeed(
            resolved.id
          );

        diagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {
          return responseJson(
            buildResult(
              feed.item,
              resolved.id,
              feed.source
            )
          );
        }

        /*
         * 有些分享鏈實際是圖文，
         * 即使 type 沒辨認到，
         * 也試 slidesinfo。
         */
        const slides =
          await getSlidesInfo(
            resolved.id
          );

        diagnostics.push(
          ...slides.diagnostics
        );

        if (slides.item) {
          return responseJson(
            buildResult(
              slides.item,
              resolved.id,
              slides.source
            )
          );
        }

        const ssr =
          await getSSR(
            resolved.id
          );

        diagnostics.push(
          ...ssr.diagnostics
        );

        if (ssr.item) {
          return responseJson(
            buildResult(
              ssr.item,
              resolved.id,
              ssr.source
            )
          );
        }
      }

      throw new Error(
        "作品 ID 已取得，但抖音沒有返回媒體資料" +
        `（${diagnostics.join(", ")}）`
      );

    } catch (error) {
      return responseJson(
        {
          ok: false,

          error:
            error?.message ||
            "解析失敗，請稍後再試"
        },
        400
      );
    }
  }
};
