"""统一 schema 基类（BUG-A01）：naive datetime 一律按 UTC 序列化。

库里 DateTime 列存的是 naive UTC（server_default=func.now()），ORM 取回
不带 tzinfo，FastAPI 序列化成 ISO8601 时丢时区标记，客户端无法判断基准。
各 schema 文件统一从这里 import BaseModel（替换 pydantic 直引），
通配 field_serializer 在 json 序列化时给 naive datetime 补 UTC 标记
（+00:00）；已带 tzinfo 的值不动。
"""

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel as _PydanticBaseModel, field_serializer


class BaseModel(_PydanticBaseModel):
    @field_serializer("*", when_used="json")
    def _serialize_naive_datetime_as_utc(self, value: Any) -> Any:
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
