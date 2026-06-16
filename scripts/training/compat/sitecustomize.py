"""Narrow runtime compatibility fixes for the pinned training environment."""

try:
    from transformers.integrations import tensor_parallel

    if not hasattr(tensor_parallel, "EmbeddingParallel"):

        class EmbeddingParallel(tensor_parallel.RowwiseParallel):
            """Compatibility symbol removed by Transformers 4.57."""

        tensor_parallel.EmbeddingParallel = EmbeddingParallel
except (ImportError, AttributeError):
    pass
