# Third-Party Notices

App: SuryaSetu (“the App”)

The App’s browser bundle includes the open-source packages below. They are listed from the installed `node_modules` (versions from `package-lock.json` at the time of writing). Each licence’s full text appears once, after the list of packages it covers.

Regenerate this list after updating dependencies (`npm ls --omit=dev` shows the production tree).

## Packages included in the App

| Package | Version | Licence | Notes |
|---|---|---|---|
| react | 18.3.1 | MIT | Includes the JSX runtime |
| react-dom | 18.3.1 | MIT |  |
| scheduler | 0.23.2 | MIT | Dependency of react-dom |
| react-router | 6.28.0 | MIT | Dependency of react-router-dom |
| react-router-dom | 6.28.0 | MIT |  |
| @remix-run/router | 1.21.0 | MIT | Dependency of react-router |
| @capacitor/core | 6.2.1 | MIT | Android app only |
| @capacitor/android | 6.2.1 | MIT | Android app only (also bundles AndroidX libraries, Apache-2.0) |
| @capacitor/filesystem | 6.0.3 | MIT | Android app only: saving exports and backups |
| @capacitor/share | 6.0.3 | MIT | Android app only: the Save or send sheet |
| @supabase/supabase-js | 2.45.4 | MIT | Cloud mode client |
| @supabase/auth-js | 2.65.0 | MIT | Dependency of supabase-js |
| @supabase/postgrest-js | 1.16.1 | MIT | Dependency of supabase-js |
| @supabase/realtime-js | 2.10.2 | MIT | Dependency of supabase-js |
| @supabase/storage-js | 2.7.0 | MIT (package.json); licence file is Apache-2.0 | Dependency of supabase-js |
| @supabase/functions-js | 2.4.1 | MIT | Dependency of supabase-js |
| @supabase/node-fetch | 2.6.15 | MIT | Only its small browser file (uses the browser’s own fetch) is bundled |
| ws | 8.22.1 | MIT | Only its browser stub is bundled (the browser’s own WebSocket is used) |
| qrcode-generator | 2.0.4 | MIT | Draws the UPI payment QR code on printed invoices and the QR code on site photos |
| vite | 5.4.20 | MIT | Build tool. Adds a small module-preload helper to the bundle |

**Production dependencies not shipped to the browser:** `loose-envify` and `js-tokens` (build-time helpers of React), `whatwg-url`, `tr46` and `webidl-conversions` (used only by the Node.js version of `@supabase/node-fetch`), and `@types/phoenix` and `@types/ws` (type definitions only). They are not in the built files, so no notice is needed for them in the App. `webidl-conversions` is BSD-2-Clause; all the others are MIT.

**Note on `@supabase/storage-js`:** its `package.json` says MIT, but the `LICENSE` file shipped in the package is the Apache License 2.0. To be safe, this notice includes both: the package is listed under both licences below.

**Development tools** (TypeScript, Vitest, Playwright, Testing Library, PGlite, jsdom and others) are used only to build and test the App and are not distributed with it.

## Services used in cloud mode

These are online services, not bundled code. Their own terms apply:

- **Supabase** (database, authentication, file storage, realtime) — supabase.com
- **Netlify** or another static web host — netlify.com
- An optional SMTP email service chosen by the Business (for example Brevo or Resend)

## Map data

The India map (`src/lib/geo/indiaMap.ts`) is generated from the public datasets below and ships inside the App. The App makes no network calls for the map. Full processing details are in `docs/third-party/map-data-sources.md`.

The App shows this attribution under every map:

> Boundaries © DataMeet India community (CC BY 4.0), simplified · PIN locations: Department of Posts, data.gov.in (GODL-India) · Places: GeoNames (CC BY 4.0). Approximate locations; not an official Survey of India map.

| Data | Source | Licence | Used for |
|---|---|---|---|
| State and UT boundaries | DataMeet India community, `States/Admin2.shp` (August 2021 version), https://github.com/datameet/maps | Creative Commons Attribution 4.0 (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ | State shapes and label points on the map |
| PIN code locations | All India Pincode Directory, Department of Posts, Ministry of Communications, Government of India, published on data.gov.in (https://data.gov.in/dataset/all-india-pincode-directory); downloaded via the GitHub copy https://github.com/dropdevrahul/pincodes-india | Government Open Data License – India (GODL), https://data.gov.in/government-open-data-license-india | Placing customers by the first three digits of their PIN code, and filling the state from a PIN code |
| City locations | GeoNames `cities1000.txt`, India rows only, https://www.geonames.org | Creative Commons Attribution 4.0 (CC BY 4.0) | Placing customers by city when there are no coordinates or PIN code |
| Towns and districts | GeoNames `IN.txt`, https://www.geonames.org | Creative Commons Attribution 4.0 (CC BY 4.0) | District names on the map; the nearest town and nearby towns on site-photo stamps |

The data was simplified, projected and aggregated (for example, PIN locations are medians per 3-digit prefix). The boundaries follow the Survey of India depiction of India’s borders as provided by the DataMeet layer, but this is a small-scale thematic map and not an official Survey of India product.

## MIT License

Applies to:

- **react** 18.3.1 — Copyright (c) Facebook, Inc. and its affiliates.
- **react-dom** 18.3.1 — Copyright (c) Facebook, Inc. and its affiliates.
- **scheduler** 0.23.2 — Copyright (c) Facebook, Inc. and its affiliates.
- **react-router** 6.28.0 — Copyright (c) React Training LLC 2015-2019; Copyright (c) Remix Software Inc. 2020-2021; Copyright (c) Shopify Inc. 2022-2023
- **react-router-dom** 6.28.0 — Copyright (c) React Training LLC 2015-2019; Copyright (c) Remix Software Inc. 2020-2021; Copyright (c) Shopify Inc. 2022-2023
- **@remix-run/router** 1.21.0 — Copyright (c) React Training LLC 2015-2019; Copyright (c) Remix Software Inc. 2020-2021; Copyright (c) Shopify Inc. 2022-2023
- **@supabase/supabase-js** 2.45.4 — Copyright (c) 2020 Supabase
- **@supabase/auth-js** 2.65.0 — Copyright (c) 2020 Supabase
- **@supabase/postgrest-js** 1.16.1 — Copyright (c) 2020 Supabase
- **@supabase/realtime-js** 2.10.2 — Copyright (c) 2020 Supabase
- **@supabase/storage-js** 2.7.0 — Copyright (c) 2020 Supabase (as stated for the other Supabase client packages; the file itself has no copyright line)
- **@supabase/functions-js** 2.4.1 — Copyright (c) 2020 Supabase
- **@supabase/node-fetch** 2.6.15 — Copyright (c) 2016 David Frank
- **ws** 8.22.1 — Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>; Copyright (c) 2013 Arnout Kazemier and contributors; Copyright (c) 2016 Luigi Pinca and contributors
- **qrcode-generator** 2.0.4 — Copyright (c) 2009 Kazuhiko Arase (licence stated in package.json and in the source header; the package ships no LICENSE file)
- **vite** 5.4.20 — Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

```
MIT License

Copyright (c) <the copyright holders listed above>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0

Applies to:

- **@supabase/storage-js** 2.7.0 — Supabase (no NOTICE file is included in the package)

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```
