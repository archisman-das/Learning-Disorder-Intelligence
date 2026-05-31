from __future__ import annotations

import torch
import torch.nn.functional as F


class GradCAM:
    def __init__(self, model: torch.nn.Module, target_layer: torch.nn.Module):
        self.model = model
        self.target_layer = target_layer
        self.activations: torch.Tensor | None = None
        self.gradients: torch.Tensor | None = None
        target_layer.register_forward_hook(self._save_activation)
        target_layer.register_full_backward_hook(self._save_gradient)

    def _save_activation(self, _module, _inputs, output):
        self.activations = output.detach()

    def _save_gradient(self, _module, _grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate(
        self,
        image: torch.Tensor,
        audio: torch.Tensor,
        text: torch.Tensor,
        errors: torch.Tensor,
        behavior: torch.Tensor | None = None,
        class_index: int | None = None,
    ) -> torch.Tensor:
        self.model.zero_grad(set_to_none=True)
        logits = self.model(image, audio, text, errors, behavior)
        if class_index is None:
            class_index = int(logits.argmax(dim=1).item())

        score = logits[:, class_index].sum()
        score.backward()

        if self.activations is None or self.gradients is None:
            raise RuntimeError("Grad-CAM hooks did not capture activations or gradients.")

        weights = self.gradients.mean(dim=(2, 3), keepdim=True)
        cam = (weights * self.activations).sum(dim=1, keepdim=True)
        cam = F.relu(cam)
        cam = F.interpolate(cam, size=image.shape[-2:], mode="bilinear", align_corners=False)
        cam_min = cam.amin(dim=(2, 3), keepdim=True)
        cam_max = cam.amax(dim=(2, 3), keepdim=True)
        return (cam - cam_min) / (cam_max - cam_min + 1e-6)


def vit_patch_attention_heatmap(model: torch.nn.Module, image: torch.Tensor) -> torch.Tensor | None:
    handwriting = getattr(model, "handwriting", None)
    if handwriting is None or not all(hasattr(handwriting, name) for name in ["patch", "cls_token", "position", "encoder"]):
        return None

    with torch.no_grad():
        patches = handwriting.patch(image).flatten(2).transpose(1, 2)
        cls = handwriting.cls_token.expand(image.shape[0], -1, -1)
        tokens = torch.cat([cls, patches], dim=1) + handwriting.position
        first_layer = handwriting.encoder.layers[0]
        attention, weights = first_layer.self_attn(
            tokens,
            tokens,
            tokens,
            need_weights=True,
            average_attn_weights=False,
        )
        _ = attention
        cls_to_patches = weights[:, :, 0, 1:].mean(dim=1)
        patch_count = cls_to_patches.shape[-1]
        grid_size = int(patch_count**0.5)
        if grid_size * grid_size != patch_count:
            return None
        heatmap = cls_to_patches.reshape(image.shape[0], 1, grid_size, grid_size)
        heatmap = F.interpolate(heatmap, size=image.shape[-2:], mode="bilinear", align_corners=False)
        heatmap_min = heatmap.amin(dim=(2, 3), keepdim=True)
        heatmap_max = heatmap.amax(dim=(2, 3), keepdim=True)
        return (heatmap - heatmap_min) / (heatmap_max - heatmap_min + 1e-6)


def transformer_text_attention_scores(model: torch.nn.Module, text: torch.Tensor) -> torch.Tensor | None:
    text_model = getattr(model, "text", None)
    if text_model is None or not all(hasattr(text_model, name) for name in ["embedding", "position", "encoder"]):
        return None

    with torch.no_grad():
        mask = text.eq(0)
        embedded = text_model.embedding(text) + text_model.position[:, : text.shape[1]]
        first_layer = text_model.encoder.layers[0]
        _, weights = first_layer.self_attn(
            embedded,
            embedded,
            embedded,
            key_padding_mask=mask,
            need_weights=True,
            average_attn_weights=False,
        )
        token_scores = weights.mean(dim=1).mean(dim=1)
        token_scores = token_scores.masked_fill(mask, 0.0)
        score_min = token_scores.amin(dim=1, keepdim=True)
        score_max = token_scores.amax(dim=1, keepdim=True)
        return (token_scores - score_min) / (score_max - score_min + 1e-6)
