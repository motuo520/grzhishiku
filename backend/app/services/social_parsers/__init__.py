from .base import BaseSocialParser, SocialMessageDict
from .wechat_parser import WeChatParser
from .dingtalk_parser import DingTalkParser
from .feishu_parser import FeiShuParser

PARSERS = {
    "wechat": WeChatParser,
    "dingtalk": DingTalkParser,
    "feishu": FeiShuParser,
}

__all__ = ["BaseSocialParser", "SocialMessageDict", "PARSERS", "WeChatParser", "DingTalkParser", "FeiShuParser"]
