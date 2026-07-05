"""大模型 provider 抽象层。

默认 Claude(Anthropic)，可切 DeepSeek / OpenAI / 任意兼容 OpenAI 协议的模型
（Agnes、本地 vLLM 等），只需改 LLM_PROVIDER + LLM_BASE_URL。

统一接口：complete(system, user) -> str（返回模型文本，通常是 JSON）。
所有网络调用都在上层用 try-except 包裹并可重试。
"""
from __future__ import annotations

import abc

from core.logger import get_logger

log = get_logger("llm")


class LLMProvider(abc.ABC):
    @abc.abstractmethod
    def complete(self, system: str, user: str) -> str:
        raise NotImplementedError


class ClaudeProvider(LLMProvider):
    """Anthropic Claude。pip install anthropic"""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-5") -> None:
        from anthropic import Anthropic
        self.client = Anthropic(api_key=api_key)
        self.model = model

    def complete(self, system: str, user: str) -> str:
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=1024,
            temperature=0.2,          # 决策要稳定，低温
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        # 取第一段文本
        for block in resp.content:
            if getattr(block, "type", "") == "text":
                return block.text
        return ""


class OpenAICompatProvider(LLMProvider):
    """兼容 OpenAI Chat Completions 协议的通用实现。

    适配 DeepSeek、OpenAI、Agnes、本地 vLLM 等——只要给对 base_url 和 model。
    pip install openai
    """

    def __init__(self, api_key: str, model: str, base_url: str = "") -> None:
        from openai import OpenAI
        kwargs = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url  # 如 https://api.deepseek.com
        self.client = OpenAI(**kwargs)
        self.model = model

    def complete(self, system: str, user: str) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            temperature=0.2,
            max_tokens=1024,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content or ""


def build_provider(provider: str, api_key: str, model: str, base_url: str = "") -> LLMProvider:
    """工厂：按配置返回对应 provider。"""
    provider = (provider or "claude").lower()
    if provider == "claude":
        return ClaudeProvider(api_key=api_key, model=model or "claude-sonnet-4-5")
    if provider == "deepseek":
        return OpenAICompatProvider(
            api_key=api_key,
            model=model or "deepseek-chat",
            base_url=base_url or "https://api.deepseek.com",
        )
    # openai / custom / agnes 等，走通用 OpenAI 兼容层
    return OpenAICompatProvider(api_key=api_key, model=model, base_url=base_url)
