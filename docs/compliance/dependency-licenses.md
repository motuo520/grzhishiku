# 依赖许可证清单 / Dependency License Report

> 生成时间：由 `pip-licenses` 根据 `backend/requirements.txt` 安装环境自动生成。
> 命令：`pip-licenses --format=markdown --with-urls`

## 合规摘要

本项目核心采用 **AGPL-3.0** 许可证。经审查，当前后端依赖主要使用以下与 AGPL-3.0 兼容的许可证：

- MIT / BSD / ISC / 0BSD / The Unlicense
- Apache-2.0
- PSF-2.0（Python 标准库及 typing_extensions）
- MPL-2.0（certifi，与 AGPL 兼容）

如果你在分发或部署时添加了新的依赖，请重新运行审查命令并确认许可证兼容性。

## 审查命令

```bash
cd backend
pip install pip-licenses
.venv/Scripts/pip-licenses --format=markdown --with-urls --output-file ../docs/compliance/dependency-licenses.md
```

> 注：此报告包含当前虚拟环境中的所有已安装包（含测试与开发工具）。生产环境最小依赖集以 `requirements.txt` 为准。

## 依赖列表

| Name                      | Version     | License                                                                        | URL                                                                  |
|---------------------------|-------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------|
| APScheduler               | 3.11.3      | MIT License                                                                    | https://apscheduler.readthedocs.io/en/3.x/versionhistory.html        |
| Mako                      | 1.3.12      | MIT License                                                                    | https://www.makotemplates.org/                                       |
| MarkupSafe                | 3.0.3       | BSD-3-Clause                                                                   | https://github.com/pallets/markupsafe/                               |
| PyJWT                     | 2.13.0      | MIT                                                                            | https://github.com/jpadilla/pyjwt                                    |
| Pygments                  | 2.20.0      | BSD-2-Clause                                                                   | https://pygments.org                                                 |
| RapidFuzz                 | 3.14.5      | MIT                                                                            | https://github.com/rapidfuzz/RapidFuzz                               |
| SQLAlchemy                | 2.0.51      | MIT                                                                            | https://www.sqlalchemy.org                                           |
| alembic                   | 1.18.5      | MIT                                                                            | https://alembic.sqlalchemy.org                                       |
| alipay-sdk-python         | 3.7.1160    | Apache Software License                                                        | https://github.com/alipay/alipay-sdk-python-all                      |
| altgraph                  | 0.17.5      | MIT License                                                                    | https://altgraph.readthedocs.io                                      |
| annotated-doc             | 0.0.4       | MIT                                                                            | https://github.com/fastapi/annotated-doc                             |
| annotated-types           | 0.7.0       | MIT License                                                                    | https://github.com/annotated-types/annotated-types                   |
| anyio                     | 4.14.1      | MIT                                                                            | https://anyio.readthedocs.io/en/stable/versionhistory.html           |
| attrs                     | 26.1.0      | MIT                                                                            | https://www.attrs.org/en/stable/changelog.html                       |
| bcrypt                    | 5.0.0       | Apache Software License                                                        | https://github.com/pyca/bcrypt/                                      |
| bleach                    | 6.4.0       | Apache Software License                                                        | https://github.com/mozilla/bleach                                    |
| boto3                     | 1.43.51     | Apache-2.0                                                                     | https://github.com/boto/boto3                                        |
| botocore                  | 1.43.51     | Apache-2.0                                                                     | https://github.com/boto/botocore                                     |
| certifi                   | 2026.6.17   | Mozilla Public License 2.0 (MPL 2.0)                                           | https://github.com/certifi/python-certifi                            |
| cffi                      | 2.0.0       | MIT                                                                            | https://cffi.readthedocs.io/en/latest/whatsnew.html                  |
| chardet                   | 7.4.3       | 0BSD                                                                           | https://github.com/chardet/chardet                                   |
| charset-normalizer        | 3.4.7       | MIT                                                                            | https://github.com/jawah/charset_normalizer/blob/master/CHANGELOG.md |
| click                     | 8.4.2       | BSD-3-Clause                                                                   | https://github.com/pallets/click/                                    |
| colorama                  | 0.4.6       | BSD License                                                                    | https://github.com/tartley/colorama                                  |
| coverage                  | 7.15.2      | Apache-2.0                                                                     | https://github.com/coveragepy/coveragepy                             |
| cryptography              | 49.0.0      | Apache-2.0 OR BSD-3-Clause                                                     | https://github.com/pyca/cryptography                                 |
| cssselect                 | 1.4.0       | BSD-3-Clause                                                                   | https://github.com/scrapy/cssselect                                  |
| distro                    | 1.9.0       | Apache Software License                                                        | https://github.com/python-distro/distro                              |
| dnspython                 | 2.8.0       | ISC License (ISCL)                                                             | https://www.dnspython.org                                            |
| ecdsa                     | 0.19.2      | MIT                                                                            | http://github.com/tlsfuzzer/python-ecdsa                             |
| email-validator           | 2.3.0       | The Unlicense (Unlicense)                                                      | https://github.com/JoshData/python-email-validator                   |
| et_xmlfile                | 2.0.0       | MIT License                                                                    | https://foss.heptapod.net/openpyxl/et_xmlfile                        |
| fastapi                   | 0.139.0     | MIT                                                                            | https://github.com/fastapi/fastapi                                   |
| filelock                  | 3.29.6      | MIT                                                                            | https://github.com/tox-dev/py-filelock                               |
| git-filter-repo           | 2.47.0      | MIT License                                                                    | https://github.com/newren/git-filter-repo                            |
| graphifyy                 | 0.9.16      | MIT License                                                                    | https://github.com/safishamsi/graphify                               |
|                           |             |                                                                                |                                                                      |
|                           |             | Copyright (c) 2026 Safi Shamsi                                                 |                                                                      |
|                           |             |                                                                                |                                                                      |
|                           |             | Permission is hereby granted, free of charge, to any person obtaining a copy   |                                                                      |
|                           |             | of this software and associated documentation files (the "Software"), to deal  |                                                                      |
|                           |             | in the Software without restriction, including without limitation the rights   |                                                                      |
|                           |             | to use, copy, modify, merge, publish, distribute, sublicense, and/or sell      |                                                                      |
|                           |             | copies of the Software, and to permit persons to whom the Software is          |                                                                      |
|                           |             | furnished to do so, subject to the following conditions:                       |                                                                      |
|                           |             |                                                                                |                                                                      |
|                           |             | The above copyright notice and this permission notice shall be included in all |                                                                      |
|                           |             | copies or substantial portions of the Software.                                |                                                                      |
|                           |             |                                                                                |                                                                      |
|                           |             | THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR     |                                                                      |
|                           |             | IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,       |                                                                      |
|                           |             | FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE    |                                                                      |
|                           |             | AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER         |                                                                      |
|                           |             | LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,  |                                                                      |
|                           |             | OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE  |                                                                      |
|                           |             | SOFTWARE.                                                                      |                                                                      |
|                           |             |                                                                                |                                                                      |
| greenlet                  | 3.5.3       | MIT AND PSF-2.0                                                                | https://greenlet.readthedocs.io                                      |
| h11                       | 0.16.0      | MIT License                                                                    | https://github.com/python-hyper/h11                                  |
| httpcore                  | 1.0.9       | BSD-3-Clause                                                                   | https://www.encode.io/httpcore/                                      |
| httpx                     | 0.28.1      | BSD License                                                                    | https://github.com/encode/httpx                                      |
| httpx-sse                 | 0.4.3       | MIT                                                                            | https://github.com/florimondmanca/httpx-sse                          |
| idna                      | 3.18        | BSD-3-Clause                                                                   | https://github.com/kjd/idna                                          |
| iniconfig                 | 2.3.0       | MIT                                                                            | https://github.com/pytest-dev/iniconfig                              |
| jiter                     | 0.16.0      | MIT                                                                            | https://github.com/pydantic/jiter/                                   |
| jmespath                  | 1.1.0       | MIT License                                                                    | https://github.com/jmespath/jmespath.py                              |
| jsonschema                | 4.26.0      | MIT                                                                            | https://github.com/python-jsonschema/jsonschema                      |
| jsonschema-specifications | 2025.9.1    | MIT                                                                            | https://github.com/python-jsonschema/jsonschema-specifications       |
| lxml                      | 6.1.1       | BSD-3-Clause                                                                   | https://lxml.de/                                                     |
| lxml_html_clean           | 0.4.5       | BSD-3-Clause                                                                   | https://github.com/fedora-python/lxml_html_clean/                    |
| mcp                       | 1.28.1      | MIT License                                                                    | https://modelcontextprotocol.io                                      |
| modelscope                | 1.38.1      | Apache-2.0                                                                     | https://github.com/modelscope/modelscope                             |
| modelscope-hub            | 0.1.7       | Apache Software License                                                        | UNKNOWN                                                              |
| networkx                  | 3.6.1       | BSD-3-Clause                                                                   | https://networkx.org/                                                |
| numpy                     | 2.5.1       | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0                             | https://numpy.org                                                    |
| openai                    | 2.45.0      | Apache Software License                                                        | https://github.com/openai/openai-python                              |
| openpyxl                  | 3.1.5       | MIT License                                                                    | https://openpyxl.readthedocs.io                                      |
| packaging                 | 26.2        | Apache-2.0 OR BSD-2-Clause                                                     | https://github.com/pypa/packaging                                    |
| passlib                   | 1.7.4       | BSD                                                                            | https://passlib.readthedocs.io                                       |
| pefile                    | 2024.8.26   | MIT                                                                            | https://github.com/erocarrera/pefile                                 |
| pillow                    | 12.3.0      | MIT-CMU                                                                        | https://python-pillow.github.io                                      |
| pluggy                    | 1.6.0       | MIT License                                                                    | UNKNOWN                                                              |
| prometheus_client         | 0.25.0      | Apache-2.0 AND BSD-2-Clause                                                    | https://github.com/prometheus/client_python                          |
| psutil                    | 7.2.2       | BSD-3-Clause                                                                   | https://github.com/giampaolo/psutil                                  |
| pyasn1                    | 0.6.3       | BSD-2-Clause                                                                   | https://github.com/pyasn1/pyasn1                                     |
| pycparser                 | 3.0         | BSD-3-Clause                                                                   | https://github.com/eliben/pycparser                                  |
| pycryptodome              | 3.23.0      | BSD License; Public Domain                                                     | https://www.pycryptodome.org                                         |
| pydantic                  | 2.13.4      | MIT                                                                            | https://github.com/pydantic/pydantic                                 |
| pydantic-settings         | 2.14.2      | MIT                                                                            | https://github.com/pydantic/pydantic-settings                        |
| pydantic_core             | 2.46.4      | MIT                                                                            | https://github.com/pydantic                                          |
| pyinstaller               | 6.21.0      | GNU General Public License v2 (GPLv2)                                          | https://pyinstaller.org                                              |
| pyinstaller-hooks-contrib | 2026.6      | Apache Software License; GNU General Public License v2 (GPLv2)                 | https://github.com/pyinstaller/pyinstaller-hooks-contrib             |
| pypdf                     | 6.14.2      | BSD-3-Clause                                                                   | https://github.com/py-pdf/pypdf                                      |
| pytest                    | 9.1.1       | MIT                                                                            | https://docs.pytest.org/en/latest/                                   |
| pytest-asyncio            | 1.4.0       | Apache-2.0                                                                     | https://github.com/pytest-dev/pytest-asyncio                         |
| pytest-cov                | 7.1.0       | MIT                                                                            | https://pytest-cov.readthedocs.io/en/latest/changelog.html           |
| python-dateutil           | 2.9.0.post0 | Apache Software License; BSD License                                           | https://github.com/dateutil/dateutil                                 |
| python-docx               | 1.2.0       | MIT License                                                                    | https://github.com/python-openxml/python-docx                        |
| python-dotenv             | 1.2.2       | BSD-3-Clause                                                                   | https://github.com/theskumar/python-dotenv                           |
| python-jose               | 3.5.0       | MIT License                                                                    | http://github.com/mpdavis/python-jose                                |
| python-multipart          | 0.0.32      | Apache-2.0                                                                     | https://github.com/Kludex/python-multipart                           |
| python-pptx               | 1.0.2       | MIT License                                                                    | https://github.com/scanny/python-pptx                                |
| pywin32                   | 312         | Python Software Foundation License                                             | https://github.com/mhammond/pywin32                                  |
| pywin32-ctypes            | 0.2.3       | BSD-3-Clause                                                                   | https://github.com/enthought/pywin32-ctypes                          |
| readability-lxml          | 0.8.4.1     | Apache License 2.0                                                             | http://github.com/buriy/python-readability                           |
| redis                     | 8.0.1       | MIT                                                                            | https://github.com/redis/redis-py                                    |
| referencing               | 0.37.0      | MIT                                                                            | https://github.com/python-jsonschema/referencing                     |
| requests                  | 2.34.2      | Apache Software License                                                        | https://github.com/psf/requests                                      |
| rpds-py                   | 2026.6.3    | MIT                                                                            | https://github.com/crate-py/rpds                                     |
| rsa                       | 4.9.1       | Apache Software License                                                        | https://stuvel.eu/rsa                                                |
| s3transfer                | 0.19.1      | Apache Software License                                                        | https://github.com/boto/s3transfer                                   |
| six                       | 1.17.0      | MIT License                                                                    | https://github.com/benjaminp/six                                     |
| sniffio                   | 1.3.1       | Apache Software License; MIT License                                           | https://github.com/python-trio/sniffio                               |
| sse-starlette             | 3.4.5       | BSD-3-Clause                                                                   | https://github.com/sysid/sse-starlette                               |
| starlette                 | 1.3.1       | BSD-3-Clause                                                                   | https://github.com/Kludex/starlette                                  |
| stripe                    | 15.3.0      | MIT License                                                                    | https://stripe.com/                                                  |
| tqdm                      | 4.68.4      | MPL-2.0 AND MIT                                                                | https://tqdm.github.io                                               |
| tree-sitter               | 0.25.2      | MIT License                                                                    | https://tree-sitter.github.io/tree-sitter/                           |
| tree-sitter-bash          | 0.25.1      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-bash                      |
| tree-sitter-c             | 0.24.2      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-c                         |
| tree-sitter-c-sharp       | 0.23.5      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-c-sharp                   |
| tree-sitter-cpp           | 0.23.4      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-cpp                       |
| tree-sitter-elixir        | 0.3.5       | MIT License                                                                    | https://github.com/elixir-lang/tree-sitter-elixir                    |
| tree-sitter-fortran       | 0.6.0       | MIT License                                                                    | https://github.com/stadelmanma/tree-sitter-fortran                   |
| tree-sitter-go            | 0.25.0      | MIT                                                                            | https://github.com/tree-sitter/tree-sitter-go                        |
| tree-sitter-groovy        | 0.1.2       | MIT                                                                            | https://github.com/amaanq/tree-sitter-groovy                         |
| tree-sitter-java          | 0.23.5      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-java                      |
| tree-sitter-javascript    | 0.25.0      | MIT                                                                            | https://github.com/tree-sitter/tree-sitter-javascript                |
| tree-sitter-json          | 0.24.8      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-json                      |
| tree-sitter-julia         | 0.23.1      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-julia                     |
| tree-sitter-kotlin        | 1.1.0       | MIT License                                                                    | https://github.com/tree-sitter-grammars/tree-sitter-kotlin           |
| tree-sitter-lua           | 0.5.0       | MIT                                                                            | https://github.com/tree-sitter-grammars/tree-sitter-lua              |
| tree-sitter-objc          | 3.0.2       | MIT                                                                            | https://github.com/tree-sitter-grammars/tree-sitter-objc             |
| tree-sitter-php           | 0.24.1      | MIT                                                                            | https://github.com/tree-sitter/tree-sitter-php                       |
| tree-sitter-powershell    | 0.26.4      | MIT                                                                            | https://github.com/airbus-cert/tree-sitter-powershell                |
| tree-sitter-python        | 0.25.0      | MIT                                                                            | https://github.com/tree-sitter/tree-sitter-python                    |
| tree-sitter-ruby          | 0.23.1      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-ruby                      |
| tree-sitter-rust          | 0.24.2      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-rust                      |
| tree-sitter-scala         | 0.26.0      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-scala                     |
| tree-sitter-swift         | 0.7.3       | MIT License                                                                    | https://github.com/alex-pinkus/tree-sitter-swift                     |
| tree-sitter-typescript    | 0.23.2      | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-typescript                |
| tree-sitter-verilog       | 1.0.3       | MIT License                                                                    | https://github.com/tree-sitter/tree-sitter-verilog                   |
| tree-sitter-zig           | 1.1.2       | MIT                                                                            | https://github.com/tree-sitter-grammars/tree-sitter-zig              |
| typing-inspection         | 0.4.2       | MIT                                                                            | https://github.com/pydantic/typing-inspection                        |
| typing_extensions         | 4.16.0      | PSF-2.0                                                                        | https://github.com/python/typing_extensions                          |
| tzdata                    | 2026.2      | Apache-2.0                                                                     | https://github.com/python/tzdata                                     |
| tzlocal                   | 5.4.4       | MIT                                                                            | https://github.com/regebro/tzlocal/blob/master/CHANGES.txt           |
| urllib3                   | 2.7.0       | MIT                                                                            | https://github.com/urllib3/urllib3/blob/main/CHANGES.rst             |
| uvicorn                   | 0.49.0      | BSD-3-Clause                                                                   | https://uvicorn.dev/                                                 |
| webencodings              | 0.5.1       | BSD License                                                                    | https://github.com/SimonSapin/python-webencodings                    |
| wechatpayv3               | 2.0.2       | MIT                                                                            | https://github.com/minibear2021/wechatpayv3                          |
| xlsxwriter                | 3.2.9       | BSD License                                                                    | https://github.com/jmcnamara/XlsxWriter                              |
