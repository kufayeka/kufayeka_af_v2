const result = {
  "path": "Jasuindo.OffsetPrinter.*",
  "count": 2,
  "matches": [
    {
      "kind": "asset",
      "path": "Jasuindo.OffsetPrinter.Taiyo1",
      "assetId": "asset_1771561995737_511",
      "value": {
        "id": "asset_1771561995737_511",
        "name": "Taiyo1",
        "parentId": "asset_1772088636848_239",
        "templateIds": [
          "template_1771523720677_855",
          "template_1772291867711_154",
          "template_1772297957808_540"
        ],
        "attributes": {
          "Machine Speed": {
            "value": 24,
            "ts": "2026-03-11T04:19:09.378Z"
          },
          "Encoder Raw Value": {
            "value": 26,
            "ts": "2026-03-11T04:19:09.448Z"
          },
          "Encoder Prev Value": {
            "value": 4,
            "ts": "2026-03-11T04:19:09.512Z"
          },
          "Work Order": {
            "value": "WO-2026-0009",
            "ts": "2026-03-11T02:35:18.095Z"
          },
          "Job Lifecycle": {
            "value": "load",
            "ts": "2026-03-11T03:56:12.123Z"
          },
          "Machine Operator": {
            "value": {
              "label": "Alice Operator",
              "value": "90efaa37-9275-41d5-bb90-06352d055f1b"
            },
            "ts": "2026-03-11T03:40:18.553Z"
          },
          "Job Lifecycle Alarm": {
            "value": "-",
            "ts": "2026-03-11T02:08:24.202Z"
          },
          "Job Activity": {
            "value": "Idle/ConveyorRusak",
            "ts": "2026-03-11T02:36:10.447Z"
          },
          "Paper Consumed Setup": {
            "value": 0,
            "ts": "2026-03-11T02:35:18.096Z"
          },
          "Job Activity Category": {
            "value": "-",
            "ts": "2026-03-11T03:40:20.270Z"
          },
          "Paper Consumed Production": {
            "value": 0,
            "ts": "2026-03-11T02:35:18.097Z"
          },
          "Paper Consumed Idle": {
            "value": 0,
            "ts": "2026-03-11T03:56:12.124Z"
          },
          "Total Production Time": {
            "value": 0,
            "ts": "2026-03-11T02:35:18.098Z"
          },
          "Total Setup Time": {
            "value": 0,
            "ts": "2026-03-11T02:35:18.098Z"
          },
          "Total Idle Time": {
            "value": 0,
            "ts": "2026-03-11T03:56:12.125Z"
          },
          "Material Barcode": {
            "value": "Material001",
            "ts": "2026-03-11T02:12:31.443Z"
          },
          "Job Activity Alarm": {
            "value": "-",
            "ts": "2026-03-06T02:03:07.120Z"
          },
          "Total Paper Waste": {
            "value": 0,
            "ts": "2026-03-11T03:56:12.124Z"
          },
          "Total Paper Consumed": {
            "value": 0,
            "ts": "2026-03-11T03:56:12.124Z"
          },
          "Product Fold Length": {
            "value": 30,
            "ts": "2026-03-11T02:12:31.444Z"
          },
          "Product Count Per Fold": {
            "value": 4,
            "ts": "2026-03-11T02:12:31.444Z"
          },
          "Running Hour": {
            "value": 4479,
            "ts": "2026-03-11T03:40:19.130Z"
          },
          "Product Good Count": {
            "value": 0,
            "ts": "2026-03-11T02:12:31.445Z"
          },
          "Product Reject Count": {
            "value": 0,
            "ts": "2026-03-11T02:12:31.445Z"
          },
          "Ply": {
            "value": "0/8",
            "ts": "2026-03-11T02:12:31.445Z"
          }
        }
      }
    },
    {
      "kind": "asset",
      "path": "Jasuindo.OffsetPrinter.Taiyo2",
      "assetId": "asset_1771562520927_537",
      "value": {
        "id": "asset_1771562520927_537",
        "name": "Taiyo2",
        "parentId": "asset_1772088636848_239",
        "templateIds": [
          "template_1771523720677_855"
        ],
        "attributes": {}
      }
    }
  ]
}


function getOperatorAssetPath(operatorId) {
  return result.matches.find((item) => {
    const operatorValue = item.value?.attributes?.['Machine Operator']?.value?.value;
    return String(operatorValue ?? '').trim() === String(operatorId ?? '').trim();
  })?.path ?? null;
}

console.log(getOperatorAssetPath('90efaa37-9275-41d5-bb90-06352d055f1b'));
