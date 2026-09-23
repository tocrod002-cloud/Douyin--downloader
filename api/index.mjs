const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Mobile Safari/537.36";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
  "Version/18.6 Mobile/15E148 Safari/604.1";

const URL_RE =
  /https?:\/\/[^\s，,、；;）)\]】》"']+/i;

const ID_PATTERNS = [
  /\/share\/(?:video|slides|note)\/(\d+)/i,
  /\/(?:video|note)\/(\d+)/i,
  /[?&](?:modal_id|aweme_id|item_ids)=(?:%5B)?(\d+)/i,
  /"aweme_id"\s*:\s*"?(\d+)"?/i,
  /"itemId"\s*:\s*"?(\d+)"?/i
];


function json(data, status = 200) {
  return Response.json(
    data,
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    }
  );
}


function douyinHost(hostname) {
  const h =
    String(hostname || "")
      .toLowerCase();

  return (
    h === "douyin.com" ||
    h.endsWith(".douyin.com") ||
    h === "iesdouyin.com" ||
    h.endsWith(".iesdouyin.com")
  );
}


function extractFirstUrl(text) {
  const match =
    String(text || "")
      .match(URL_RE);

  return match
    ? match[0]
    : null;
}


function extractAwemeId(text) {
  const value =
    String(text || "");

  for (const pattern of ID_PATTERNS) {
    const match =
      value.match(pattern);

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


function detectType(text) {
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


async function resolveInput(rawInput) {
  const input =
    String(rawInput || "")
      .trim();

  if (!input) {
    throw new Error(
      "請貼上抖音分享文字或鏈接"
    );
  }

  const firstUrl =
    extractFirstUrl(input);

  const directId =
    extractAwemeId(input);

  if (
    directId &&
    (
      !firstUrl ||
      !/v\.douyin\.com/i.test(
        firstUrl
      )
    )
  ) {
    return {
      awemeId: directId,
      typeHint:
        detectType(input),
      finalUrl:
        firstUrl || ""
    };
  }

  if (!firstUrl) {
    throw new Error(
      "找不到抖音鏈接"
    );
  }

  let current;

  try {
    current =
      new URL(firstUrl);
  } catch {
    throw new Error(
      "鏈接格式不正確"
    );
  }

  for (
    let i = 0;
    i < 10;
    i += 1
  ) {

    if (
      !douyinHost(
        current.hostname
      )
    ) {
      throw new Error(
        "只支援 douyin.com / iesdouyin.com 鏈接"
      );
    }

    const id =
      extractAwemeId(
        current.href
      );

    if (id) {
      return {
        awemeId: id,
        typeHint:
          detectType(
            current.href
          ),
        finalUrl:
          current.href
      };
    }

    const response =
      await fetch(
        current,
        {
          redirect: "manual",

          headers: {
            "User-Agent":
              IPHONE_UA,

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

    const idFromHtml =
      extractAwemeId(
        html
      );

    if (idFromHtml) {
      return {
        awemeId:
          idFromHtml,

        typeHint:
          detectType(
            current.href +
            " " +
            html
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


/* -----------------------------------------
   JSON / SSR 解析
----------------------------------------- */


function scanObject(
  text,
  start
) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (
    let i = start;
    i < text.length;
    i += 1
  ) {

    const ch =
      text[i];

    if (inString) {

      if (escaped) {
        escaped = false;

      } else if (
        ch === "\\"
      ) {
        escaped = true;

      } else if (
        ch === '"'
      ) {
        inString = false;
      }

      continue;
    }

    if (
      ch === '"'
    ) {
      inString = true;
      continue;
    }

    if (
      ch === "{"
    ) {
      depth += 1;
    }

    if (
      ch === "}"
    ) {
      depth -= 1;
    }

    if (
      depth === 0
    ) {
      return text.slice(
        start,
        i + 1
      );
    }
  }

  return null;
}


function scanString(
  text,
  start
) {
  let escaped =
    false;

  for (
    let i = start + 1;
    i < text.length;
    i += 1
  ) {

    const ch =
      text[i];

    if (escaped) {
      escaped = false;

    } else if (
      ch === "\\"
    ) {
      escaped = true;

    } else if (
      ch === '"'
    ) {
      return text.slice(
        start,
        i + 1
      );
    }
  }

  return null;
}


/*
 * 重要修正：
 *
 * 抖音目前兩種都可能出現：
 *
 * window._ROUTER_DATA = {...}
 *
 * 或：
 *
 * window._ROUTER_DATA = "{\"loaderData\":...}"
 */
function extractRouterData(html) {
  const marker =
    html.indexOf(
      "_ROUTER_DATA"
    );

  if (
    marker < 0
  ) {
    return null;
  }

  const equal =
    html.indexOf(
      "=",
      marker
    );

  if (
    equal < 0
  ) {
    return null;
  }

  let pos =
    equal + 1;

  while (
    pos < html.length &&
    /\s/.test(
      html[pos]
    )
  ) {
    pos += 1;
  }

  try {

    if (
      html[pos] === "{"
    ) {

      const raw =
        scanObject(
          html,
          pos
        );

      if (!raw) {
        return null;
      }

      return JSON.parse(
        raw
      );
    }

    if (
      html[pos] === '"'
    ) {

      const literal =
        scanString(
          html,
          pos
        );

      if (!literal) {
        return null;
      }

      const decoded =
        JSON.parse(
          literal
        );

      return JSON.parse(
        decoded
      );
    }

  } catch (error) {
    console.error(
      "ROUTER_DATA parse:",
      error
    );
  }

  return null;
}


function extractScriptJson(
  html,
  id,
  decode = false
) {

  const escaped =
    id.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `<script[^>]+id=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`,
      "i"
    );

  const match =
    html.match(regex);

  if (!match) {
    return null;
  }

  try {

    const raw =
      decode
        ? decodeURIComponent(
            match[1]
          )
        : match[1];

    return JSON.parse(raw);

  } catch {
    return null;
  }
}


/*
 * 先直接找最常見結構，
 * 再做遞迴搜尋。
 */
function directItem(
  data
) {

  if (
    !data ||
    typeof data !==
      "object"
  ) {
    return null;
  }

  if (
    Array.isArray(
      data.item_list
    ) &&
    data.item_list[0]
  ) {
    return data.item_list[0];
  }

  if (
    Array.isArray(
      data.aweme_list
    ) &&
    data.aweme_list[0]
  ) {
    return data.aweme_list[0];
  }

  if (
    data.aweme_detail
  ) {
    return data.aweme_detail;
  }

  if (
    data.aweme
  ) {
    return data.aweme;
  }

  const loader =
    data.loaderData;

  if (
    loader &&
    typeof loader ===
      "object"
  ) {

    for (
      const value
      of Object.values(
        loader
      )
    ) {

      const item =
        value?.videoInfoRes
          ?.item_list?.[0] ||

        value?.videoInfoRes
          ?.aweme_list?.[0] ||

        value?.aweme_detail ||

        value?.aweme;

      if (item) {
        return item;
      }
    }
  }

  return null;
}


function findItem(
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

      const result =
        findItem(
          value,
          targetId,
          seen,
          depth + 1
        );

      if (result) {
        return result;
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

  const hasImages =
    Boolean(
      node.images ||
      node.image_list ||
      node.image_infos ||
      node.original_images ||
      node.image_post_info ||
      node.imagePostInfo
    );

  const hasVideo =
    Boolean(
      node.video
    );

  if (
    (
      hasImages ||
      hasVideo
    ) &&
    (
      !targetId ||
      !id ||
      id ===
        String(targetId)
    )
  ) {
    return node;
  }

  for (
    const value
    of Object.values(node)
  ) {

    const result =
      findItem(
        value,
        targetId,
        seen,
        depth + 1
      );

    if (result) {
      return result;
    }
  }

  return null;
}


function getItem(
  data,
  awemeId
) {

  if (!data) {
    return null;
  }

  const direct =
    directItem(data);

  if (direct) {

    const id =
      String(
        direct.aweme_id ||
        direct.awemeId ||
        ""
      );

    if (
      !id ||
      id ===
        String(awemeId)
    ) {
      return direct;
    }
  }

  return findItem(
    data,
    awemeId
  );
}


/* -----------------------------------------
   媒體 URL
----------------------------------------- */


function pickUrl(
  value,
  preferLast = false
) {

  if (!value) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {

    return value.startsWith(
      "http"
    )
      ? value
      : null;
  }

  if (
    Array.isArray(value)
  ) {

    const urls =
      value.filter(
        item =>
          typeof item ===
            "string" &&
          item.startsWith(
            "http"
          )
      );

    if (
      !urls.length
    ) {
      return null;
    }

    const https =
      urls.filter(
        url =>
          url.startsWith(
            "https://"
          )
      );

    const list =
      https.length
        ? https
        : urls;

    return preferLast
      ? list[
          list.length - 1
        ]
      : list[0];
  }

  if (
    typeof value ===
    "object"
  ) {

    return (
      pickUrl(
        value.url_list,
        preferLast
      ) ||

      pickUrl(
        value.urlList,
        preferLast
      ) ||

      pickUrl(
        value.urls,
        preferLast
      ) ||

      (
        typeof value.url ===
        "string"

          ? value.url
          : null
      )
    );
  }

  return null;
}


function imageNodes(item) {

  const candidates = [
    item?.image_post_info
      ?.images,

    item?.image_post_info
      ?.image_list,

    item?.imagePostInfo
      ?.images,

    item?.imagePostInfo
      ?.imageList,

    item?.images,

    item?.image_list,

    item?.image_infos,

    item?.original_images
  ];

  return (
    candidates.find(
      value =>
        Array.isArray(value) &&
        value.length > 0
    ) || []
  );
}


/*
 * 優先順序：
 *
 * 原圖 / download
 * ↓
 * origin
 * ↓
 * display
 * ↓
 * 普通 url_list
 */
function imageUrl(image) {

  if (!image) {
    return null;
  }

  return (
    pickUrl(
      image.download_url,
      true
    ) ||

    pickUrl(
      image.downloadUrl,
      true
    ) ||

    pickUrl(
      image.download_url_list,
      true
    ) ||

    pickUrl(
      image.downloadUrlList,
      true
    ) ||

    pickUrl(
      image.origin_url,
      true
    ) ||

    pickUrl(
      image.originUrl,
      true
    ) ||

    pickUrl(
      image.origin_image,
      true
    ) ||

    pickUrl(
      image.originImage,
      true
    ) ||

    pickUrl(
      image.display_image,
      true
    ) ||

    pickUrl(
      image.displayImage,
      true
    ) ||

    pickUrl(
      image.url_list,
      true
    ) ||

    pickUrl(
      image.urlList,
      true
    ) ||

    pickUrl(
      image,
      true
    )
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


function coverUrl(item) {

  const video =
    item?.video || {};

  return (
    pickUrl(
      video.origin_cover ||
      video.originCover,
      true
    ) ||

    pickUrl(
      video.cover,
      true
    ) ||

    pickUrl(
      item?.video?.dynamic_cover,
      true
    ) ||

    pickUrl(
      item?.cover,
      true
    ) ||

    null
  );
}


function bestVideo(item) {

  const video =
    item?.video || {};

  const candidates =
    [];

  const bitRates =
    video.bit_rate ||
    video.bitRate ||
    [];

  if (
    Array.isArray(bitRates)
  ) {

    for (
      const entry
      of bitRates
    ) {

      const addr =
        entry?.play_addr_h264 ||
        entry?.playAddrH264 ||
        entry?.play_addr ||
        entry?.playAddr;

      const url =
        cleanVideoUrl(
          pickUrl(
            addr,
            true
          )
        );

      if (!url) {
        continue;
      }

      candidates.push(
        {
          url,

          width:
            Number(
              addr?.width ||
              entry?.width ||
              video.width ||
              0
            ),

          height:
            Number(
              addr?.height ||
              entry?.height ||
              video.height ||
              0
            ),

          bitrate:
            Number(
              entry?.bit_rate ||
              entry?.bitRate ||
              0
            ),

          size:
            Number(
              entry?.data_size ||
              entry?.dataSize ||
              0
            ),

          h265:
            Boolean(
              entry?.is_h265 ||
              entry?.isH265
            )
        }
      );
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

    const url =
      cleanVideoUrl(
        pickUrl(
          addr,
          true
        )
      );

    if (!url) {
      continue;
    }

    candidates.push(
      {
        url,

        width:
          Number(
            addr?.width ||
            video.width ||
            0
          ),

        height:
          Number(
            addr?.height ||
            video.height ||
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
      }
    );
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

  unique.sort(
    (
      a,
      b
    ) => {

      /*
       * Safari 優先 H.264
       */
      if (
        a.h265 !==
        b.h265
      ) {
        return Number(
          a.h265
        ) -
        Number(
          b.h265
        );
      }

      const areaA =
        a.width *
        a.height;

      const areaB =
        b.width *
        b.height;

      if (
        areaA !== areaB
      ) {
        return (
          areaB -
          areaA
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


function buildResult(
  item,
  awemeId,
  source
) {

  const nodes =
    imageNodes(item);

  const images =
    nodes
      .map(
        (
          image,
          index
        ) => {

          const url =
            imageUrl(image);

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

  const authorObj =
    item?.author ||
    item?.authorInfo ||
    {};

  const author =
    authorObj.nickname ||
    authorObj.name ||
    authorObj.unique_id ||
    authorObj.uniqueId ||
    "";

  const desc =
    String(
      item?.desc ||
      item?.caption ||
      item?.title ||
      ""
    ).trim();

  if (
    images.length
  ) {

    return {
      ok: true,

      post: {
        id:
          String(
            item?.aweme_id ||
            item?.awemeId ||
            awemeId
          ),

        type:
          "images",

        author,
        desc,

        cover:
          images[0].preview,

        source
      },

      media:
        images
    };
  }

  const video =
    bestVideo(item);

  if (
    !video?.url
  ) {
    throw new Error(
      "已取得作品資料，但沒有找到圖片或影片地址"
    );
  }

  return {
    ok: true,

    post: {
      id:
        String(
          item?.aweme_id ||
          item?.awemeId ||
          awemeId
        ),

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


/* -----------------------------------------
   策略 1：
   舊 ItemInfo API
   圖集特別值得先試
----------------------------------------- */


async function fetchItemInfo(
  awemeId
) {

  const url =
    "https://www.iesdouyin.com/" +
    "web/api/v2/aweme/iteminfo/" +
    "?item_ids=" +
    encodeURIComponent(
      awemeId
    );

  const diagnostics =
    [];

  for (
    const ua
    of [
      IPHONE_UA,
      ANDROID_UA
    ]
  ) {

    try {

      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                ua,

              "Accept":
                "application/json,text/plain,*/*",

              "Accept-Language":
                "zh-CN,zh;q=0.9",

              "Referer":
                "https://www.iesdouyin.com/"
            },

            redirect:
              "follow",

            cache:
              "no-store"
          }
        );

      diagnostics.push(
        `iteminfo:${response.status}`
      );

      if (
        !response.ok
      ) {
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
        getItem(
          data,
          awemeId
        );

      if (item) {

        return {
          item,
          source:
            "iteminfo",
          diagnostics
        };
      }

    } catch {

      diagnostics.push(
        "iteminfo:ERR"
      );
    }
  }

  return {
    item: null,
    source: null,
    diagnostics
  };
}


/* -----------------------------------------
   策略 2：
   Mobile Feed
----------------------------------------- */


async function fetchFeed(
  awemeId
) {

  const endpoints = [
    "https://api5-normal-c-hl.amemv.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128",

    "https://aweme.snssdk.com/" +
      "aweme/v1/feed/" +
      "?aweme_id=" +
      encodeURIComponent(
        awemeId
      ) +
      "&aid=1128"
  ];

  const diagnostics =
    [];

  for (
    const url
    of endpoints
  ) {

    try {

      const response =
        await fetch(
          url,
          {
            headers: {
              "User-Agent":
                ANDROID_UA,

              "Accept":
                "application/json",

              "Accept-Language":
                "zh-CN,zh;q=0.9"
            },

            redirect:
              "follow",

            cache:
              "no-store"
          }
        );

      diagnostics.push(
        `feed:${response.status}`
      );

      if (
        !response.ok
      ) {
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
        getItem(
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


/* -----------------------------------------
   策略 3：
   SSR 分享頁
----------------------------------------- */


async function fetchSSR(
  awemeId,
  typeHint
) {

  const kinds =
    typeHint === "slides"

      ? [
          "slides",
          "note",
          "video"
        ]

      : [
          "video",
          "slides",
          "note"
        ];

  const diagnostics =
    [];

  /*
   * Android / iPhone 都試。
   *
   * 抖音不同時間對不同 UA
   * 返回的 SSR 結構不完全一致。
   */
  for (
    const ua
    of [
      IPHONE_UA,
      ANDROID_UA
    ]
  ) {

    for (
      const kind
      of kinds
    ) {

      const url =
        `https://www.iesdouyin.com/share/${kind}/${awemeId}/?from_ssr=1`;

      try {

        const response =
          await fetch(
            url,
            {
              headers: {
                "User-Agent":
                  ua,

                "Accept":
                  "text/html,application/xhtml+xml,*/*",

                "Accept-Language":
                  "zh-CN,zh;q=0.9",

                "Referer":
                  "https://www.douyin.com/"
              },

              redirect:
                "follow",

              cache:
                "no-store"
            }
          );

        const html =
          await response.text();

        const markers = [
          html.includes(
            "_ROUTER_DATA"
          )
            ? "R"
            : "-",

          html.includes(
            "RENDER_DATA"
          )
            ? "D"
            : "-",

          html.includes(
            "__UNIVERSAL_DATA_FOR_REHYDRATION__"
          )
            ? "U"
            : "-"
        ].join("");

        diagnostics.push(
          `${kind}:${response.status}:${html.length}:${markers}`
        );

        if (
          !response.ok
        ) {
          continue;
        }

        const candidates = [
          extractRouterData(
            html
          ),

          extractScriptJson(
            html,
            "RENDER_DATA",
            true
          ),

          extractScriptJson(
            html,
            "__UNIVERSAL_DATA_FOR_REHYDRATION__"
          )
        ].filter(Boolean);

        for (
          const data
          of candidates
        ) {

          const item =
            getItem(
              data,
              awemeId
            );

          if (item) {

            return {
              item,

              source:
                `ssr-${kind}`,

              diagnostics
            };
          }
        }

      } catch {

        diagnostics.push(
          `${kind}:ERR`
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


/* -----------------------------------------
   Main
----------------------------------------- */


export default {

  async fetch(request) {

    if (
      request.method !==
      "GET"
    ) {

      return json(
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

      const input =
        requestUrl
          .searchParams
          .get("url") ||
        "";

      const resolved =
        await resolveInput(
          input
        );

      const diagnostics =
        [];


      /*
       * 圖文：
       *
       * ItemInfo
       * → SSR
       * → Feed
       */
      if (
        resolved.typeHint ===
        "slides"
      ) {

        const itemInfo =
          await fetchItemInfo(
            resolved.awemeId
          );

        diagnostics.push(
          ...itemInfo.diagnostics
        );

        if (itemInfo.item) {

          return json(
            buildResult(
              itemInfo.item,
              resolved.awemeId,
              itemInfo.source
            )
          );
        }


        const ssr =
          await fetchSSR(
            resolved.awemeId,
            "slides"
          );

        diagnostics.push(
          ...ssr.diagnostics
        );

        if (ssr.item) {

          return json(
            buildResult(
              ssr.item,
              resolved.awemeId,
              ssr.source
            )
          );
        }


        const feed =
          await fetchFeed(
            resolved.awemeId
          );

        diagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {

          return json(
            buildResult(
              feed.item,
              resolved.awemeId,
              feed.source
            )
          );
        }

      } else {

        /*
         * 普通影片：
         *
         * 保留你現在已經成功的
         * Feed 主路徑。
         */
        const feed =
          await fetchFeed(
            resolved.awemeId
          );

        diagnostics.push(
          ...feed.diagnostics
        );

        if (feed.item) {

          return json(
            buildResult(
              feed.item,
              resolved.awemeId,
              feed.source
            )
          );
        }


        const itemInfo =
          await fetchItemInfo(
            resolved.awemeId
          );

        diagnostics.push(
          ...itemInfo.diagnostics
        );

        if (itemInfo.item) {

          return json(
            buildResult(
              itemInfo.item,
              resolved.awemeId,
              itemInfo.source
            )
          );
        }


        const ssr =
          await fetchSSR(
            resolved.awemeId,
            resolved.typeHint
          );

        diagnostics.push(
          ...ssr.diagnostics
        );

        if (ssr.item) {

          return json(
            buildResult(
              ssr.item,
              resolved.awemeId,
              ssr.source
            )
          );
        }
      }


      throw new Error(
        "作品 ID 已取得，但目前仍沒有取得媒體資料" +
        `（${diagnostics.join(", ")}）`
      );

    } catch (error) {

      return json(
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
