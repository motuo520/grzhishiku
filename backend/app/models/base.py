# 兼容 shim：本文件的模型已按领域拆分至同目录的
# user / content / capsule / knowledge / attention / admin / graph /
# emergence / support / cognitive / messaging 模块。
# 此处统一再导出，既有 `from app.models.base import X` 代码零改动继续可用。
from app.models.user import *
from app.models.content import *
from app.models.capsule import *
from app.models.knowledge import *
from app.models.attention import *
from app.models.admin import *
from app.models.graph import *
from app.models.emergence import *
from app.models.support import *
from app.models.cognitive import *
from app.models.messaging import *
