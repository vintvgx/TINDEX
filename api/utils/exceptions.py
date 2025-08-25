
class UserNotFoundError(Exception):
    """Raised when a user is not found in the system."""
    
    def __init__(self, user_id: str, message: str = None):
        """
        Initialize UserNotFoundError.
        
        Args:
            user_id: The user ID that was not found
            message: Optional custom error message
        """
        self.user_id = user_id
        self.message = message or f"User with ID '{user_id}' not found in the system"
        super().__init__(self.message)
    
    def __str__(self):
        return self.message
    
    def __repr__(self):
        return f"UserNotFoundError(user_id='{self.user_id}', message='{self.message}')"